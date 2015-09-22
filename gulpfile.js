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
    testem     = require('testem');

function initBundler () {
  if(!global.b) {
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
      run('bundle');
    });
    b.on('log', gutil.log);
    chokidar.watch('./src/browser/index.dust').on('change', function() {
      run('dev');
    });
  }

  return global.b;
}

function initStyleWatcher() {
  if(!global.styleWatcher) {
    global.styleWatcher = chokidar.watch('./src/browser/**/*.scss').on('change', function() {
      run('styles');
    });
  }
}

function renderIndex(manifest, done) {
  var index    = dust.compileFn(fs.readFileSync('./src/browser/index.dust', 'utf8'), 'index');
      //manifest = JSON.parse(fs.readFileSync('./var/build/rev-manifest.json'));
  
  Object.keys(manifest).forEach(function(key) {
    manifest[key.replace('.', '-')] = manifest[key];
  });

  index(manifest, function(err, out) {
    if(err) {
      gutil.log(err);
      done();
    } else {
      fs.writeFileSync('./var/build/index.html', out);
      done();
    }
  });
}

gulp.task('dev', ['bundle', 'styles'], function(done) {
  global.livereload = livereload.listen();

  renderIndex({ 'bundle.js': 'bundle.js', 'app.css': 'app.css' }, function() {
    initStyleWatcher();
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

gulp.task('styles', function() {
  gulp.src('./src/browser/**/*.scss')
    .pipe(sass({
      outputStyle: 'compressed',
      sourceComments: 'map',
      includePaths: ['./node_modules/bootstrap/scss', './src/browser/**/*.scss']
    }).on('error', gutil.log))
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest('./var/build'))
    .pipe(livereload());
});

gulp.task('rev', function(done) {
  return gulp.src(['./var/build/**/*.js', './var/build/**/*.css'])
    .pipe(rev())
    .pipe(gulp.dest('./var/build/'))
    .pipe(rev.manifest({
      merge: true
    }))
    .pipe(gulp.dest('./var/build'));
});

gulp.task('bundle', bundle);
function bundle() {
    return initBundler().bundle()
      .on('error', gutil.log.bind(gutil, 'Browserify Error'))
      .pipe(source('bundle.js'))
      .pipe(buffer())
      .pipe(sourcemaps.init({loadMaps: true}))
      .pipe(uglify())
      .on('error', gutil.log)
      .pipe(sourcemaps.write('.'))
      .pipe(gulp.dest('./var/build'))
      .pipe(livereload());
}
