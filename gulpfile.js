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
    clean      = require('gulp-clean'),
    run        = require('run-sequence'),
    chokidar   = require('chokidar'),
    testem     = require('testem');

var customOpts = {
  entries: ['./browser.js'],
  debug: true
};
var opts = assign({}, watchify.args, customOpts);
var b = watchify(browserify(opts));

b.transform(dustify);

gulp.task('dev', ['bundle'], function(done) {
  var index    = dust.compileFn(fs.readFileSync('./src/browser/index.dust', 'utf8'), 'index'),
      manifest = JSON.parse(fs.readFileSync('./var/build/rev-manifest.json'));

  Object.keys(manifest).forEach(function(key) {
    manifest[key.replace('.', '-')] = manifest[key];
  });

  console.log("manifest!", manifest);

  index(manifest, function(err, out) {
    if(err) {
      gutil.log(err);
      done();
    } else {
      fs.writeFileSync('./var/build/index.html', out);
      done(); 
    }
  });
});

gulp.task('test', function() {
  var t = new testem();
  return t.startCI(require('./.testem.json'));
});

b.on('update', function() {
  run(['clean', 'dev']);
});
b.on('log', gutil.log);
chokidar.watch('./src/browser/index.dust').on('change', function() {
  run('dev');
});

gulp.task('clean', function(done) {
  return gulp.src('./var/build', {read:false})
    .pipe(clean());
});

gulp.task('bundle', ['clean'], bundle);
function bundle() {
    return b.bundle()
      .on('error', gutil.log.bind(gutil, 'Browserify Error'))
      .pipe(source('bundle.js'))
      .pipe(buffer())
      .pipe(sourcemaps.init({loadMaps: true}))
      .pipe(uglify())
      .on('error', gutil.log)
      .pipe(rev())
      .pipe(sourcemaps.write('./'))
      .pipe(gulp.dest('./var/build'))
      .pipe(rev.manifest())
      .pipe(gulp.dest('./var/build'));
}
