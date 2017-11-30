var toukei = require( '../toukei.js' )

var server = toukei.createServer( {
  intervals: [ 5000, 1000 ],
  port: 3375
} )

server.start()

// var statsAgent = toukei.createAgent( {
//   port: 3000
// } )
// statsAgent.send( 'test.count:' + 1 + '|c' )
