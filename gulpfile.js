var watchify   = require('watchify'),
    browserify = require('browserify'),
    gulp       = require('gulp'),
    source     = require('vinyl-source-stream'),
    buffer     = require('vinyl-buffer'),
    gutil      = require('gulp-util'),
    sourcemaps = require('gulp-sourcemaps'),
    assign     = require('lodash.assign'),
    rev        = require('gulp-rev'),
    dustify    = require('browserify-dustjs'),
    uglify     = require('gulp-uglify'),
    dust       = require('dustjs-linkedin'),
    fs         = require('fs'),
    rimraf     = require('rimraf'),
    mkdirp     = require('mkdirp'),
    run        = require('run-sequence'),
    chokidar   = require('chokidar'),
    sass       = require('gulp-sass'),
    livereload = require('gulp-livereload'),
    testem     = require('testem'),
    s3         = require('knox'),
    Promise    = require('bluebird');

function initBundler(dev) {
  if(!global.b && dev) {
    var customOpts = {
      entries: ['./browser.js'],
      debug: true,
      cache: {},
      packageCache: {},
      fullPaths: true
    };
    var opts = assign({}, watchify.args, customOpts);
    var b = watchify(browserify(opts));

    b.transform(dustify);

    global.b = b;

    b.on('update', function() {
      run('bundle-dev');
    });
    b.on('log', gutil.log);
    chokidar.watch('./src/browser/index.dust').on('change', function() {
      run('dev');
    });

    return b;
  } else if(!dev) {
    var customOpts = {
      entries: ['./browser.js'],
      debug: false,
      fullPaths: false
    };

    var b = browserify(customOpts);

    b.transform(dustify);

    return b;
  } else if(dev) {
    return global.b;
  }
}

function S3PutPromisifier(method) {
  return function(file, opts, src) {
    var args = [].slice.call(arguments);
    var self = this;

    return new Promise(function(resolve, reject) {
      var emitter = method.apply(self, args);

      emitter.on('error', function(err) {
        reject([err, file, opts]);
      });

      emitter.on('response', function(res) {
        if(res.statusCode === 200) {
          resolve([res, file, opts]);
        } else {
          reject([res, file, opts]);
        }
      });

      emitter.on('abort', function() {
        reject(new Promise.CancellationError());
      });

      emitter.on('timeout', function() {
        reject(new Promise.TimeoutError());
      });

      emitter.end(src);
    });
  }
}

Promise.promisifyAll(s3, {
  promisifier: S3PutPromisifier,
  filter: function(name) {
    if(name === 'put') return true;
  }
});

function initStyleWatcher() {
  if(!global.styleWatcher) {
    global.styleWatcher = chokidar.watch('./src/browser/**/*.scss').on('change', function() {
      run('styles');
    });
  }
}

function renderIndex(manifest, versioned, done) {
  var index    = dust.compileFn(fs.readFileSync('./src/browser/index.dust', 'utf8'), 'index');
 
  var cleaned = {};
  Object.keys(manifest).forEach(function(key) {
    cleaned[key.replace('.', '-')] = manifest[key];
  });

  index(cleaned, function(err, out) {
    if(err) {
      gutil.log(err);
      done();
    } else {
      var filename;
      if(versioned) {
        filename = manifest['bundle.js'].replace('bundle-', '').replace('.js', '') + manifest['app.css'].replace('app-', '').replace('.css', '') + '.html';
      } else {
        filename = 'index.html';
      }
      fs.writeFileSync('./var/build/' + filename, out);
      done(filename);
    }
  });
}

gulp.task('dev', ['bundle-dev', 'styles-dev'], function(done) {
  global.livereload = livereload.listen();

  renderIndex({ 'bundle.js': 'bundle.js', 'app.css': 'app.css' }, false, function() {
    initStyleWatcher();
  });
});

gulp.task('publish', ['bundle', 'styles'], function(done) {
  run('rev', function() {
    var manifest = JSON.parse(fs.readFileSync('./var/build/rev-manifest.json'));
      
    renderIndex(manifest, true, function(filename) {
      var env = JSON.parse(fs.readFileSync('./.env.json'));

      var client = s3.createClient({
        key: env.aws.accessKey,
        secret: env.aws.secretKey,
        region: 'us-west-1',
        bucket: env.aws.publishBucket
      });

      Promise.promisifyAll(client, {
        promisifier: S3PutPromisifier,
        filter: function(name) {
          if(name === 'put') return true;
        }
      });

      var uploads = [];
      var indexSrc = fs.readFileSync('./var/build/' + filename);
      var indexReq = client.putAsync(filename, {
        'Content-Length': Buffer.byteLength(indexSrc),
        'Content-Type': 'text/html',
      }, indexSrc);
      uploads.push(indexReq);

      Object.keys(manifest).forEach(function(file) {
        var src = fs.readFileSync('./var/build/' + manifest[file]);
        var req = client.putAsync(manifest[file], {
          'Content-Length': Buffer.byteLength(src)
        }, src);

        uploads.push(req);
      });

      Promise.all(uploads).then(function success(items) {
        items.forEach(function(item) {
          gutil.log("Successfully uploaded file", item[1]);
        });
        done();
      }, function failure(items) {
        items.forEach(function(item) {
          gutil.log("Error uploading file", item[1], item[0], item[2]);
        });
        done();
      }).catch(function(e) {
        gutil.log("Exception occured uploading one or more files", e);
        process.exit(1);
      });
    });
  });
}); 

gulp.task('test', function() {
  var t = new testem();
  return t.startCI(require('./.testem.json'));
});

gulp.task('clean', function(done) {
  rimraf('./var/build', function() {
    mkdirp.sync('./var/build');
    fs.writeFileSync('./var/build/rev-manifest.json', JSON.stringify({}));
    done();
  });
});

gulp.task('styles', styles());
gulp.task('styles-dev', styles(true));
function styles(dev) {
  return function() {
    if(dev) {
      return gulp.src('./src/browser/app.scss')
        .pipe(sass({
          outputStyle: 'compressed',
          sourceComments: 'map',
          includePaths: ['./node_modules/bootstrap/scss', './src/browser/**/*.scss']
        }).on('error', gutil.log))
        .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest('./var/build'))
        .pipe(livereload());
    } else {
      return gulp.src('./src/browser/app.scss')
        .pipe(sass({
          outputStyle: 'compressed',
          includePaths: ['./node_modules/bootstrap/scss', './src/browser/**/*.scss']
        }).on('error', gutil.log))
        .pipe(gulp.dest('./var/build'));
    }
  }
}

gulp.task('rev', function(done) {
  return gulp.src(['./var/build/bundle.js', './var/build/app.css'])
    .pipe(rev())
    .pipe(gulp.dest('./var/build/'))
    .pipe(rev.manifest({
      merge: true
    }))
    .pipe(gulp.dest('./var/build'));
});

gulp.task('bundle', bundle());
gulp.task('bundle-dev', bundle(true));
function bundle(dev) {
    return function() {
      if(dev) {
        var p = initBundler(true).bundle()
          .on('error', gutil.log.bind(gutil, 'Browserify Error'))
          .pipe(source('bundle.js'))
          .pipe(buffer())
          .pipe(sourcemaps.init({loadMaps: true}))
          .pipe(uglify())
          .on('error', gutil.log)
          .pipe(sourcemaps.write('.'))
          .pipe(gulp.dest('./var/build'))
          .pipe(livereload());
        return p;
      } else {
        var p = initBundler().bundle()
          .on('error', gutil.log.bind(gutil, 'Browserify Error'))
          .pipe(source('bundle.js'))
          .pipe(buffer())
          .pipe(uglify())
          .on('error', gutil.log)
          .pipe(gulp.dest('./var/build'));
        return p;
      }
    }
}
