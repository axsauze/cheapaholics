//setup Dependencies
var connect = require('connect')
    , express = require('express')
    , io = require('socket.io')
    , fs = require('fs')
    , port = (process.env.PORT || 8081)
    , async = require('async')
    , mysql = require('mysql')
    , ebay = require('ebay-api')
    , util = require('util');

//Initiate the Amazon apac operation helper
var amazon = new (require('apac').OperationHelper)({
      awsId: 'AKIAJIOLE4OXTQDEAHSQ'
    , awsSecret: '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'
    , assocId: '9877-6481-2323'
});

//Setup Express
var server = express.createServer();
server.configure(function(){
    server.set('views', __dirname + '/views');
    server.set('view options', { layout: false });
    server.use(connect.bodyParser());
    server.use(express.cookieParser());
    server.use(express.session({ secret: "shhhhhhhhh!"}));
    server.use(connect.static(__dirname + '/static'));
    server.use(server.router);
});

//setup the errors
server.error(function(err, req, res, next){
    if (err instanceof NotFound) {
        res.render('404.jade', { locals: {
                  title : '404 - Not Found'
                 ,description: ''
                 ,author: ''
                 ,analyticssiteid: 'XXXXXXX'
                },status: 404 });
    } else {
        res.render('500.jade', { locals: {
                  title : 'The Server Encountered an Error'
                 ,description: ''
                 ,author: ''
                 ,analyticssiteid: 'XXXXXXX'
                 ,error: err
                },status: 500 });
    }
});
server.listen(port);

//Setup Socket.IO
var io = io.listen(server);
io.sockets.on('connection', function(socket){
    console.log('Client Connected');

    socket.on('query_request', function(query){
        var params = {};

        //Calling ebay and amazon request asyncronously - execute function once both are done
        async.series({
                ebay: function(callback) {
                    params = {};

                    //Save query to file -- TODO: SAVE IN DATABASE
                    fs.appendFile('queries', query + '\r\n', function (err) {
                        fs.appendFile('errors', err, function (err) {
                             if (err) throw err;
                        });
                        if (err) throw err;
                    });

                    //FILTERING QUERY (Removing symbols, whitespaces, validating it, etc)
                    //removing symbols
                    query = query.replace(/[^A-Za-z ]/g,'');
                    //removing whitespaces and single characters - they are replaced with 'undefined' tokens
                    query = query.split(' ').map(function(x) {
                        if(x.length < 2) {
                            return;
                        }
                        if(/^\d+$/.test(x))
                            return "'" + x + "'";
                        else if (x != '')
                            return x;
                    });
                    //Remove all undefined tokens
                    var un = query.indexOf(undefined);
                    while (un != -1) {
//                        console.log(un);
                        query.splice(un, 1);
                        un = query.indexOf(undefined)
                    }
                    //check that query is not empty
                    if(query < 1) {
                        return;
                    }

                    params.keywords = query;
                    params['GLOBAL-ID'] = 'EBAY-GB';
                    params.outputSelector = [ 'AspectHistogram' ];
                    params['paginationInput.entriesPerPage'] = 10;

//                    console.log(query);
                    console.log(params.keywords);

                    filters = {};
                    filters.itemFilter = [
                        new ebay.ItemFilter("ListingType", ["FixedPrice"])
                    ];
                    requestEbayQuery(query, params, filters, callback);
                },
                amazon: function(callback) {
                    amazon.endPoint = 'ecs.amazonaws.co.uk';

                    requestAmazonQuery(query, callback);
                }
            }, // Now the results are passed to the following function as { ebay: x, amazon: y }
            function(error, results) {
                if (error) {
                    fs.appendFile('errors', error+'\n\r', function (error) {
                        if (error) throw error;
                    });
                    if (error) throw error;
                }

                var composite = results.amazon.items.concat(results.ebay.items);

                //Sorting object by price
                function idComparison(property) {
                    return function (a, b) {
                        return parseInt(a[property]) - parseInt(b[property]);
                    };
                }
                composite.sort(idComparison('minprice'));

                var finalResult = {
                      ebayquery: results.ebay.queryUrl
                    , amazonquery: results.amazon.queryUrl
                    , items: composite
                }
//                console.log(composite, {depth: 1});
                socket.emit('query_result', finalResult);
            }
        );
    });

    socket.on('disconnect', function(){
        console.log('Client Disconnected.');
    });
});


///////////////////////////////////////////
//          Execute Queries              //
//EBAY query
function requestEbayQuery(query, params, filters, callback) {
    ebay.ebayApiGetRequest({
              serviceName: 'FindingService'
            , opType: 'findItemsByKeywords'
            , appId: 'HackaSot-b5e3-4d5e-b9dd-f5f631f9c60f'
            , params: params
            , filters: filters
            , parser: ebay.parseItemsFromResponse
        }
        , function (error, results) {
            if (error) {
                fs.appendFile('errors', error, function (error) {
                    if (error)  throw error;
                });
                if (error) throw error;
            }
            standardizeEbayResults(error, results, callback);
        }
    );//(error, result)
}
//AMAZON query
function requestAmazonQuery(query, callback) {
    amazon.execute('ItemSearch', {
              'Keywords': query
            , 'ResponseGroup': 'Medium'
            , 'SearchIndex': 'All'
        }
        , function(error, results) {
            if (error) {
                fs.appendFile('errors', error, function (error) {
                    if (error) throw error;
                });
                if (error) throw error;
            }
            standardizeAmazonResults(error, results, callback);
        }
    );
}
///////////////////////////////////////////
//         Standarize Results            //
//Ebay
function standardizeEbayResults(error, results, callback){
    var queryUrl = results.queryUrl;
    var standardized = [];
    if(results) {
        results.forEach(function(item) {
            var priceObj = item['sellingStatus']['currentPrice'];
            var priceKey = Object.keys(item['sellingStatus']['currentPrice'])[0];
            var minprice = priceObj[priceKey];

            var sItem = {
                  emarket: 'ebay'
                , itemUrl: item['viewItemURL']
                , itemId: item['itemId']
                , itemTitle: item['title']
                , imageUrl: item['galleryURL']
                , minprice: minprice
                , price: item['sellingStatus']['currentPrice']
            }
            standardized.push(sItem);
        });
    }
    var standardizedItems = {
          queryUrl: queryUrl
        , items : standardized
    }
    callback(error, standardizedItems);
}
//Amazon
function standardizeAmazonResults(error, results, callback){
    var queryUrl = results.ItemSearchResponse.Items[0].MoreSearchResultsUrl[0];

    var standardized = [];

    allItems = results.ItemSearchResponse.Items[0].Item;

    if(allItems) {
        allItems.forEach(function(item) {
            var ia = item['ItemAttributes'][0];
            var os = item.hasOwnProperty('OfferSummary') ? item['OfferSummary'][0] : "";
            var newit = os.hasOwnProperty('LowestNewPrice') ? os['LowestNewPrice'][0]['Amount'][0]/100.0 : "";
            var used = os.hasOwnProperty('LowestUsedPrice') ? os['LowestUsedPrice'][0]['Amount'][0]/100.0 : "";
            var refurb = os.hasOwnProperty('LowestRefurbishedPrice') ? os['LowestRefurbishedPrice'][0]['Amount'][0]/100.0 : "";
            var minprice = (refurb ? (used ? Math.min(refurb, used) : Math.min(newit, refurb)) : (used ? Math.min(used, newit) : newit) );
            var image = item.hasOwnProperty('MediumImage')? item['MediumImage'][0].URL : "";
            minprice = minprice;
            var sItem = {
                  emarket: 'amazon'
                , itemUrl: item['DetailPageURL']
                , itemId: item['ASIN']
                , itemTitle: ia['Title']
                , imageUrl: image
                , minprice: minprice
                , price: {
                      used: used
                    , refurbished: refurb
                    , new: newit
                }
            }
            standardized.push(sItem);
        });
    }
    var standardizedItems = {
          queryUrl: queryUrl
        , items : standardized
    }
    callback(error, standardizedItems);
}

///////////////////////////////////////////
//              Routes                   //
///////////////////////////////////////////

server.get('/', function(req,res){
  res.render('index.jade', {
    locals : { 
              title : 'Cheapaholics'
             ,description: 'E-commerce comparison website'
             ,author: 'Alejandro Saucedo'
             ,analyticssiteid: 'XXXXXXX' 
            }
  });
});

//A Route for Creating a 500 Error (Useful to keep around)
server.get('/500', function(req, res){
    throw new Error('This is a 500 Error');
});

//The 404 Route (ALWAYS Keep this as the last route)
server.get('/*', function(req, res){
    throw new NotFound;
});

function NotFound(msg){
    this.name = 'NotFound';
    Error.call(this, msg);
    Error.captureStackTrace(this, arguments.callee);
}


console.log('Listening on http://0.0.0.0:' + port );
