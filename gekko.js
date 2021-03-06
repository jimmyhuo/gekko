/*

  Gekko is a Bitcoin trading bot for popular Bitcoin exchanges written 
  in node, it features multiple trading methods using technical analysis.

  Disclaimer:

  USE AT YOUR OWN RISK!

  The author of this project is NOT responsible for any damage or loss caused 
  by this software. There can be bugs and the bot may not perform as expected 
  or specified. Please consider testing it first with paper trading / 
  backtesting on historical data. Also look at the code to see what how 
  it is working.

*/

var util = require(__dirname + '/core/util');
var dirs = util.dirs();

var _ = require('lodash');
var async = require('async');

var log = require(dirs.core + 'log');

var pluginHelper = require(dirs.core + 'pluginUtil');

// if the user just wants to see the current version
if(util.getArgument('v')) {
  util.logVersion();
  util.die();
}

// make sure the current node version is recent enough
if(!util.recentNode())
  util.die([
    'Your local version of Node.js is too old. ',
    'You have ',
    process.version,
    ' and you need atleast ',
    util.getRequiredNodeVersion()
  ].join(''));

var config = util.getConfig();

// Temporary checks to make sure everything we need is
// up to date and present on the system.

// temp at Fri Jan 17 16:00:19 CET 2014
if(config.normal)
  util.die('Please update your config! config.normal is now called config.watch');
if(config.EMA)
  util.die('Please update your config! EMA is now called DEMA');
// temp at Wed Jan 22 12:18:08 CET 2014
if(!config.profitSimulator.slippage)
  util.die('Please update your config! The profit simulator is missing slippage');
// temp at Sun Feb  9 17:13:45 CET 2014
if(!config.DEMA.thresholds)
  util.die('Please update your config! DEMA indicator is missing threshold parameter');
// temp at Sun Feb 23 14:39:09 CET 2014
if(!config.RSI)
  util.die('Please update your config! RSI indicator is missing');

if(
  config.trader.enabled &&
  !config['I understand that Gekko only automates MY OWN trading strategies']
)
  util.die('Do you understand what Gekko will do with your money? Read this first:\n\nhttps://github.com/askmike/gekko/issues/201');

// START

log.info('Gekko v' + util.getVersion(), 'started');
log.info('I\'m gonna make you rich, Bud Fox.', '\n\n');

// currently we only support a single 
// market and a single advisor.

var exchanges = require(dirs.gekko + 'exchanges');
var exchange = _.find(exchanges, function(e) {
  return e.slug === config.watch.exchange.toLowerCase();
});

if(!exchange)
  util.die('Unsupported exchange: ' + config.watch.exchange.toLowerCase())

var exchangeChecker = require(util.dirs().core + 'exchangeChecker');

var error = exchangeChecker.cantMonitor(config.watch);
if(error)
  util.die(error, true);

var Market = require(dirs.budfox + 'budfox');
var GekkoStream = new require(dirs.core + 'gekkoStream');

// all plugins
var plugins = [];
// all emitting plugins
var emitters = {};
// all plugins interested in candles
var candleConsumers = [];

// Instantiate each enabled plugin
var loadPlugins = function(next) {
  // parameters for every plugin that tell us
  // what we are dealing with.
  var pluginParameters = require(dirs.gekko + 'plugins');

  // load all plugins
  async.mapSeries(
    pluginParameters,
    pluginHelper.load,
    function(error, _plugins) {

      if(error)
        return util.die(error, true);

      plugins = _.compact(_plugins);
      next();
    }
  );
};

// Some plugins emit their own events, store
// a reference to those plugins.
var referenceEmitters = function(next) {

  _.each(plugins, function(plugin) {
    if(plugin.meta.emits)
      emitters[plugin.meta.slug] = plugin;
  });

  next();
}

var subscribePlugins = function(next) {
  var subscriptions = require(dirs.gekko + 'subscriptions');

  // events broadcasted by plugins
  var pluginSubscriptions = _.filter(
    subscriptions,
    function(sub) {
      return sub.emitter !== 'market';
    }
  );

  // subscribe interested plugins to
  // emitting plugins
  _.each(plugins, function(plugin) {
    _.each(pluginSubscriptions, function(sub) {
      if(_.has(plugin, sub.handler)) {

        // if a plugin wants to listen
        // to something disabled
        if(!emitters[sub.emitter]) {
          return log.warn([
            plugin.meta.name,
            'wanted to listen to the',
            sub.emitter + ',',
            'however the',
            sub.emitter,
            'is disabled.'
          ].join(' '));
        }

        // attach handler
        emitters[sub.emitter]
          .on(sub.event,
            plugin[
              sub.handler
            ])
      }

    });
  });

  // events broadcasted by the market
  var marketSubscriptions = _.filter(
    subscriptions,
    {emitter: 'market'}
  );

  // subscribe plugins to the market
  _.each(plugins, function(plugin) {
    _.each(marketSubscriptions, function(sub) {

      // for now, only subscribe to candles
      if(sub.event !== 'candle')
        return;

      if(_.has(plugin, sub.handler))
        candleConsumers.push(plugin);

    });
  });

  next();
}

log.info('Setting up Gekko in', util.gekkoMode(), 'mode');
log.info('');

async.series(
  [
    loadPlugins,
    referenceEmitters,
    subscribePlugins
  ],
  function() {

    // everything is setup!

    var market = new Market(config)
      .start()
      .pipe(new GekkoStream(candleConsumers))

      // convert JS objects to JSON string
      // .pipe(new require('stringify-stream')())
      // output to standard out
      // .pipe(process.stdout);

  }
);