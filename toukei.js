// <metricname>:<value>|<type>

// metric types
// https://github.com/etsy/statsd/blob/master/docs/metric_types.md
//
// sampling:    c -- counter
// timing:      ms -- milliseconds
// gauges       g -- gague
// sets:        s

var createAgent = require( './agent.js' )
var createServer = require( './server.js' )


var parseLine = require( './parse-line.js' )

module.exports = {
  createAgent: createAgent,
  createServer: createServer,
  parseLine: parseLine
}

