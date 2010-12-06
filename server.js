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

function getOut(code, error, resp) {
    if( error && !resp ) {
        resp = error;
        error = undefined;
    }

    resp.writeHead(code);
    resp.end(JSON.stringify({
        status: 'error',
        message: error || 'Unknown error'
    }));
}

function reply(faces, id, resp) {
    resp.writeHead(200, { 'Content-Type': 'application/json' });
    resp.end(JSON.stringify({
        status: 'success',
        faces: faces,
        image_url: 'http://localhost:5000/image/'+id,
        share_url: 'http://localhost:5000/view/'+id
    }));
}

function addToRedis(path, callback) {
    var client = redis.createClient();
    client.on('connected', function() {
        client.incr('mugshot:image:globalId', function(err, id) {
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

/*
 * Create a temporary writable file
 * delete it when the callback is done
 */
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
            var parts = url.parse(remote);
            var client = http.createClient(80, parts.host);
            client.request('GET', parts.pathname || '/', {
                'host' : parts.host
              , 'user-agent' : 'FaceDetector'
            })
            .on('response', function(remoteresponse) {
                 remoteresponse.on('data', function(data) {
                     stream.write(data);
                 })
                 .on('end', function() {
                     stream.on('close', function() {
                         addToRedis(stream.path, function(err, id) {
                             // we aren't concerned about the error
                             // because we can always reply with
                             // the list of faces right now even
                             // if we can't cache it
                             reply(face.faces(stream.path), id, response);
                         });
                     });
                     stream.end();
                 })
                 .on('error', function() {
                     getOut(500, response);
                 });;
            }).end();
        });
    });
};

function handleFile(request, response) {
    withFile(function(stream) {
        request.on('data', function(data) {
            stream.write(data);
        });
        request.on('error', console.log);
        request.on('end', function() {
            stream.on('close', function() {
                 addToRedis(stream.path, function(err, id) {
                     // we aren't concerned about the error
                     // because we can always reply with
                     // the list of faces right now even
                     // if we can't cache it
                     reply(face.faces(stream.path), id, response);
                 });
            });
            stream.end();
        });
    });
};

http.createServer( function(request, response) {
    if( request.method != 'POST' && request.method != 'PUT' ) {
        getOut(405, 'PUT or POST Only', response);
        return;
    }

    var path = url.parse(request.url).pathname;
    if( path === '/faces/file' ) {
        handleFile(request, response);
        return;
    }

    if( path === '/faces/url' ) {
        handleUrl(request, response);
        return;
    }

    getOut(404, response);
}).listen(process.argv[2] || 80);
