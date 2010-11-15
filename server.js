var http = require('http')
  , util = require('util')
  , fs = require('fs')
  , url = require('url')
  , cp = require('child_process')
  , face = require('./face')

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

function reply(faces, resp) {
    resp.writeHead(200, { 'Content-Type': 'application/json' });
    resp.end(JSON.stringify({
        status: 'success',
        faces: faces
    }));
}

/*
 * Create a temporary writable file
 * delete it when the callback is done
 */
function tempFile(callback) {
    // TODO gen random filename
    var filename = '/tmp/face.abcd';
    console.log(filename);
    var stream = fs.createWriteStream(filename);
    callback(stream);
}

function handleUrl(request, response) {
    tempFile(function(stream) {
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
                         reply(face.faces(stream.path), response);
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
    tempFile(function(stream) {
        request.on('data', function(data) {
            stream.write(data);
        });
        request.on('error', console.log);
        request.on('end', function() {
            stream.on('close', function() {
                reply(face.faces(stream.path), response);
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
