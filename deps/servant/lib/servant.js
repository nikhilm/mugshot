var util = require('util')
  , url = require('url')
  , fs = require('fs')
  , mime = require('./mime')
  , querystring = require('querystring')
  , constants = process.binding('constants')
  , path_m = require('path')

exports.debug = false;

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad (n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

// 26 Feb 16:19:34
function timestamp () {
  var d = new Date();
  return  [ d.getDate()
          , months[d.getMonth()]
          , [pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds())].join(':')
          ].join(' ');
}

function log() {
    if( exports.debug ) {
        var d = new Date();

        var message = Array.prototype.map.call(arguments, function(elt) {
            if( typeof(elt) == 'string' )
                return elt;
            else
                return util.inspect(elt);
        });
        util.debug( '[' + timestamp() + '] ' + message.join(' '));
    }
}

function cleanPath(root, path) {
    path = path_m.join(root, querystring.unescape(path.slice(1)));

    path = path_m.normalize(path);

    if( path.indexOf(root) != 0 )
        return null;
    return path;
}

exports.Servant = Servant = function(root, options) {
    this.root = require('path').normalize(root == '.' ? process.cwd() : root);

    // options?
    this.options = {
        list_directories: false
    };

    if( options && options.list_directories === true )
        this.options.list_directories = true;
}

Servant.prototype.serveFile = function(request, response, path, stats, callback) {
    // TODO range requests
    // TODO last-modified and if-modified-since

    // 'dumb' file type based detection
    var mtype = mime.contentTypes[
        require('path').extname(path).slice(1)
    ] || 'text/plain';

    response.writeHead(200, {
        "content-type": mtype
      , "content-length": stats.size
    });
    var instream = fs.createReadStream(path);

    instream.on('data', function(chunk) {
        response.write(chunk);
    }).on('end', function() {
        response.end();
        callback && callback(null, {
            status: 200
          , path: path
          , directory: false
        });
    }).on('error', function(err) {
        response.end();
        log("ERROR", err);
    });
}

Servant.prototype.serveDir = function(request, response, path, callback) {
    log(path, "is a directory");
    fs.readdir(path, function(err, files) {
        response.writeHead(200, { "content-type": 'text/html' });
        response.write('<ul>\n');
        files.forEach(function(f, i) {
            response.write('<li>' + f + '</li>\n');
            if( i == files.length-1) {
                response.end('</ul>\n');
                callback && callback(null, {
                    status: 200
                  , path: path
                  , directory: true
                });
            }
        });
    });
}
/*
 * Serve's a file from root based on the request
 * to response
 *
 * Callback is function(err)
 */
Servant.prototype.serve = function(request, response, callback) {
    var finish = function(code, message, callback) {
        log(code);
        response.writeHead(code);
        response.end();
        if( typeof callback === 'function' )
            callback(true, {
                status: code
              , message: message
            });
    }

    var path = url.parse(request.url).pathname;
    log("Received", request.method, path);

    path = cleanPath(this.root, path);

    if( !path ) {
        finish(403, "Out of root path " + path,  callback);
        return;
    }

    var self = this;
    fs.stat( path, function(err, stats) {
        if( err ) {
            log("Stat failed on", path, err);
            if( err.errno == constants.ENOENT )
                finish(404, path + " does not exist", callback);
            else if( err.errno == constants.EACCES )
                finish(403, "Permission denied for " + path, callback);
            else
                finish(500, "Something went wrong with stat on " + path,  callback);
        }
        else {
            if( stats.isFile() ) {
                self.serveFile(request, response, path, stats, callback);
            }
            else if( stats.isDirectory() ) {
                var index = path_m.join(path, 'index.html');
                fs.stat( index, function(err, stats) {
                    if( err ) {
                        // TODO bad code re-use
                        log("Stat failed on", path, err);
                        if( err.errno == constants.ENOENT ) {
                            if( self.options.list_directories ) {
                                self.serveDir(request, response, path, callback);
                            }
                            else {
                                finish(403, "Directory listing not permitted",  callback);
                            }
                            finish(404, path + " does not exist", callback);
                        }
                        else if( err.errno == constants.EACCES )
                            finish(403, "Permission denied for " + path, callback);
                        else
                            finish(500, "Something went wrong with stat on " + path,  callback);
                    }
                    else {
                        self.serveFile(request, response, index, stats, callback);
                    }
                });
            }
            else {
                log(path, "Not file or directory");
                finish(422, path + " Unknown device type. Not a file/directory ", callback);
            }
        }
    });
}
