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

var pageTemplate = _.template(fs.readFileSync('view.html', 'utf8'));

function viewInBrowser(request, response, id) {
    var r = redis.createClient();
    r.on('connected', function() {
        r.get('mugshot:image:' + id, function(err, path) {
            if( err ) {
                response.writeHead(404, { "content-type": "text/html" });
                response.end("No such image.");
            }
            else {
                response.writeHead(200, { "content-type": "text/html" });
                response.write(pageTemplate({ image_url: 'http://localhost:5000/image/' + require('path').basename(path.toString()), faces: JSON.stringify(face.faces(path.toString())) }));
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

router.notFound(function(request, response) {
    static.serve(request, response, function(err, obj) {
        if(err) {
            response.writeHead(404);
            response.end("Page Not Found.");
        }
    });
});

http.createServer(router).listen(process.argv[2]||5000);
