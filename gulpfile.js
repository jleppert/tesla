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
    knox       = require('knox'),
    aws        = require('aws-sdk'),
    Promise    = require('bluebird'),
    git        = require('git-rev');

var args = require('minimist')(process.argv.slice(2));
var env = Object.freeze(JSON.parse(fs.readFileSync('./.env.json')));

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
        reject({ err: err, file: file, opts: opts});
      });

      emitter.on('response', function(res) {
        if(res.statusCode === 200) {
          resolve({res: res, file: file, opts: opts});
        } else {
          reject({ res: res, file: file, opts: opts});
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

function initStyleWatcher() {
  if(!global.styleWatcher) {
    global.styleWatcher = chokidar.watch('./src/browser/**/*.scss').on('change', function() {
      run('styles');
    });
  }
}

function renderIndex(manifest, versioned, done) {
  var index    = dust.compileFn(fs.readFileSync('./src/browser/index.dust', 'utf8'), 'index');
 
  git.short(function(hash) {
    var cleaned = {};
    Object.keys(manifest).forEach(function(key) {
      cleaned[key.replace('.', '-')] = '/' + hash + '/' + manifest[key];
    });

    // TODO: move files

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
  });
}

gulp.task('dev', ['bundle-dev', 'styles-dev'], function(done) {
  global.livereload = livereload.listen();

  renderIndex({ 'bundle.js': 'bundle.js', 'app.css': 'app.css' }, false, function() {
    initStyleWatcher();
  });
});

function getCreateS3Client() {
  if(global.client) return client;

  var client = knox.createClient({
    key: env.aws.accessKey,
    secret: env.aws.secretKey,
    region: env.aws.region,
    bucket: env.aws.publishBucket
  });

  Promise.promisifyAll(client, {
    promisifier: S3PutPromisifier,
    filter: function(name) {
      if(name === 'put') return true;
    }
  });

  global.client = client;

  return client;
}

gulp.task('publish', ['bundle', 'styles'], function(done) {
  run('rev', function() {
    var manifest = JSON.parse(fs.readFileSync('./var/build/rev-manifest.json'));
      
    renderIndex(manifest, true, function(filename) {
      var client = getCreateS3Client();
      
      var uploads = [];
      var indexSrc = fs.readFileSync('./var/build/' + filename);
      git.short(function(hash) {
        var indexReq = client.putAsync('/' + hash + '/' + filename, {
          'Content-Length': Buffer.byteLength(indexSrc),
          'Content-Type': 'text/html',
        }, indexSrc);
        uploads.push(indexReq);

        Object.keys(manifest).forEach(function(file) {
          var src = fs.readFileSync('./var/build/' + manifest[file]);
          var req = client.putAsync('/' + hash + '/' + manifest[file], {
            'Content-Length': Buffer.byteLength(src)
          }, src);

          uploads.push(req);
        });

        manifest.index = filename;
        var manifestStr = JSON.stringify(manifest);
        var manifestReq = client.putAsync('/' + hash + '/index.json', {
          'Content-Length': Buffer.byteLength(manifestStr),
          'Content-Type': 'application/json'
        }, manifestStr);
        uploads.push(manifestReq);

        Promise.all(uploads).then(function success(items) {
          items.forEach(function(item) {
            gutil.log("Successfully uploaded file", item.file);
          });
          done();
        }, function failure(items) {
          items.forEach(function(item) {
            gutil.log("Error uploading file", item.file, item.res);
          });
          done();
        }).catch(function(e) {
          gutil.log("Exception occured uploading one or more files", e);
          process.exit(1);
        });
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

gulp.task('list', function(done) {
  var env = JSON.parse(fs.readFileSync('./.env.json'));

  var client = knox.createClient({
    key: env.aws.accessKey,
    secret: env.aws.secretKey,
    region: env.aws.region,
    bucket: env.aws.publishBucket
  });

  client.list({}, function(err, data) {
    if(err) {
      gutil.log("Error listing contents of bucket", env.aws.publishBucket);
    } else {
      data.Contents.forEach(function(item) {
        if(item.Key.indexOf('index.json') != -1) {
          gutil.log('Version', item.Key.split('/')[0]);
        }
      });
    }

    done();
  });
});

gulp.task('activate', function(done) {
  var env = JSON.parse(fs.readFileSync('./.env.json'));

  aws.config.update({
    accessKeyId: env.aws.accessKey, 
    secretAccessKey: env.aws.secretKey,
    region: env.aws.region 
  });

  var s3 = new aws.S3({ params: { Bucket: env.aws.publishBucket }});

  console.log(args.sha.substr(0, 7) + '/index.json');
 
  s3.getObject({
    Bucket: env.aws.publishBucket,
    Key: args.sha.substr(0, 7) + '/index.json'
  }, function(err, data) {
    if(err) {
      gutil.log("Error getting index config from S3", err);
      process.exit(1);
    } else {
      var config = JSON.parse(data.Body.toString());
      console.log(args.sha.substr(0, 7) + '/' + config.index);

      s3.getObject({
        Bucket: env.aws.publishBucket,
        Key: args.sha.substr(0, 7) + '/' + config.index
      }, function(err, data) {
        if(err) {
          gutil.log("Error getting index from S3", err);
          process.exit(1);
        } else {
          var index = data.toString();
          var client = getCreateS3Client();

          var deployedJSON = JSON.stringify(config);
          client.putAsync('/' + 'deployed.json', {
            'Content-Length': Buffer.byteLength(deployedJSON),
            'Content-Type': 'application/json',
            'Expires': 0,
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }, deployedJSON).then(function success(item) {
            gutil.log("Successfully uploaded deployed json", item.file, "for sha", args.sha.substr(0, 7));
          }, function failure(item) {
            gutil.log("Error uploading deployed json", item.file, item.res);
            process.exit(1);
          });

          client.putAsync('/' + 'index.html', {
            'Content-Length': Buffer.byteLength(index),
            'Content-Type': 'text/html',
            'Expires': 0,
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }, index).then(function success(item) {
            gutil.log("Successfully uploaded index", item.file, "for sha", args.sha.substr(0, 7));
          }, function failure(item) {
            gutil.log("Error uploading index", item.file, item.res);
            process.exit(1);
          });
        }
      });
    }
  });
});

gulp.task('show-active', function(done) {
  var env = JSON.parse(fs.readFileSync('./.env.json'));

  aws.config.update({
    accessKeyId: env.aws.accessKey, 
    secretAccessKey: env.aws.secretKey,
    region: env.aws.region 
  });

  var s3 = new aws.S3({ params: { Bucket: env.aws.publishBucket }});
  
  s3.getBucketWebsite({
    Bucket: env.aws.publishBucket
  }, function(err, data) {
    if(err) {
      gutil.log("Error occured getting bucket details from S3", err);
    } else {
      gutil.log("Active Index Document:", data.IndexDocument);
    }
  });
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
