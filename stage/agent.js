var toukei = require( '../toukei.js' )

var statsAgent = toukei.createAgent( { port: 3375 } )
// var statsAgent = toukei.createAgent( { port: 3375, silent: true } )

setInterval( function () {
  statsAgent.send( 'test.count:' + 1 + '|c' )
}, 250 )
