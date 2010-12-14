var http = require('http')
  , util = require('util')
  , fs = require('fs')
  , url = require('url')
  , cp = require('child_process')
  , face = require('./face')
  , servant = require('./deps/servant/lib/servant')
  , choreo = require('./deps/choreographer/choreographer')
  , redis = require('./deps/redis-node-client/lib/redis-client')
  , _ = require('./deps/underscore-1.1.3')._

var HOST = 'localhost';
var PORT = parseInt(process.argv[2])||8080;
var URL = 'http://' + HOST + ':' + PORT;
var DBNO = 5;
var MAX_SIZE = 5*1024*1024; // allow 5mb

function getOut(code, error, resp) {
    if( error && !resp ) {
        resp = error;
        error = undefined;
    }

    resp.writeHead(code, { 'Content-Type': 'application/json' });
    resp.end(JSON.stringify({
        status: 'error',
        message: error || 'Unknown error'
    }));
}

function reply(faces, id, path, resp) {
    if( typeof(faces) == 'string' ) {
        getOut(415, faces == 'No Error' ? 'Unknown error' : faces, resp);
        return;
    }

    var obj = {
        status: 'success',
        faces: faces,
        id: id,
        image_url: URL + '/image/'+require('path').basename(path),
        share_url: URL + '/view/'+id
    };
    resp.writeHead(200, { 'Content-Type': 'application/json' });
    resp.end(JSON.stringify(obj));
}

function addToRedis(path, callback) {
    var client = redis.createClient();
    client.on('connected', function() {
        client.select(DBNO);
        client.incr('mugshot:globalId', function(err, id) {
            if( !err ) {
                client.set('mugshot:image:' + id, path, function(err) {
                    callback(err, id);
                });
            }
            else {
                callback(err, null);
            }
        });
    });
}

function withFile(callback) {
    // TODO gen random filename
    var filename = '/tmp/data/face.'+process.pid+'.'+parseInt(Math.random()*10000);
    var stream = fs.createWriteStream(filename);
    callback(stream);
}

function handleUrl(request, response) {
    withFile(function(stream) {
        var remote = "";
        request.on('data', function(data) {
            remote += data.toString();
        });
        request.on('end', function() {
            var size = 0;
            var error = false;
            var parts = url.parse(remote);
            var client = http.createClient(80, parts.host);
            client.request('GET', parts.pathname || '/', {
                'host' : parts.host
              , 'user-agent' : 'Mugshot FaceDetector'
            })
            .on('response', function(remoteresponse) {
                 remoteresponse.on('data', function(data) {
                     if( size > MAX_SIZE ) {
                         error = true;
                         remoteresponse.emit('error', 'File size exceeded');
                        remoteresponse.destroy();
                        return;
                     }
                     stream.write(data);
                     size += data.length;
                 })
                 .on('end', function() {
                     // the 'close' callback gets
                     // added only if error is false
                     // so this is ok
                     stream.end();
                     if( error )
                         return;

                     stream.on('close', function() {
                         addToRedis(stream.path, function(err, id) {
                             // we aren't concerned about the error
                             // because we can always reply with
                             // the list of faces right now even
                             // if we can't cache it
                             reply(face.faces(stream.path), id, stream.path, response);
                         });
                     });
                 })
                 .on('error', function() {
                     fs.unlink(stream.path);
                     if( error )
                         getOut(413, 'Maximum size allowed is '+MAX_SIZE+' bytes', response);
                     else
                         getOut(500, response);
                 });;
            }).end();
        });
    });
};

function handleFile(request, response) {
    withFile(function(stream) {
        var size = 0;
        var error = false;
        request.on('data', function(data) {
            if( size > MAX_SIZE ) {
                error = true;
               request.emit('error', 'File size exceeded');
               return;
            }
            stream.write(data);
            size += data.length;
        });
        request.on('error', function() {
            if( error ) {
                getOut(413, 'Maximum size allowed is '+MAX_SIZE+' bytes', response);
                fs.unlink(stream.path);
            }
            else
                console.log("Request error ", arguments);
        });
        request.on('end', function() {
            stream.end();
            if( error )
                return;
            stream.on('close', function() {
                 addToRedis(stream.path, function(err, id) {
                     // we aren't concerned about the error
                     // because we can always reply with
                     // the list of faces right now even
                     // if we can't cache it
                     reply(face.faces(stream.path), id, stream.path, response);
                 });
            });
        });
    });
};

var pageTemplate = _.template(fs.readFileSync('view.html', 'utf8'));

function viewInBrowser(request, response, id) {
    var r = redis.createClient();
    r.on('connected', function() {
        r.select(DBNO);
        r.get('mugshot:image:' + id, function(err, path) {
            if( err || !path ) {
                response.writeHead(404, { "content-type": "text/html" });
                response.end("No such image.");
            }
            else {
                response.writeHead(200, { "content-type": "text/html" });
                response.write(pageTemplate({ image_url: URL + '/image/' + require('path').basename(path.toString()), faces: JSON.stringify(face.faces(path.toString())) }));
                response.end();
            }
        });
    });
}

var images = new servant.Servant('/tmp/data');
var static = new servant.Servant('.');
var router = choreo.router();

router.get('/view/*', viewInBrowser);

router.post('/file', handleFile);

router.post('/url', handleUrl);

router.get('/image/*', function(request, response) {
    request.url = request.url.replace(/^\/image/, '');
    images.serve(request, response);
});

router.get('/*', function(request, response) {
    static.serve(request, response);
});

router.notFound(function(request, response) {
    static.serve(request, response, function(err, obj) {
        if(err) {
            response.writeHead(404);
            response.end("Page Not Found.");
        }
    });
});

http.createServer(router).listen(PORT);
