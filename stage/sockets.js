var kiite = require( 'kiite' )

var socket = kiite.connect({ port: 3375 })

socket.on( 'connect', function () {
  console.log( ' >> connected to server' )
} )

socket.on( 'flush', function ( stats ) {
  console.log()
  console.log( 'got stats' )
  console.log( stats )
} )

socket.on( 'disconnect', function () {
  console.log( ' << disconnected from server' )
} )
