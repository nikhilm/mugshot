var face = require( "./face" )
  , sys = require( "sys" )

if( process.argv.length < 3 ) {
    sys.puts("Usage: node test.js <filename>");
    process.exit(1);
}
sys.debug(sys.inspect(face.faces(process.argv[2])));
