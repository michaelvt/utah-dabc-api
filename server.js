var request = require('request'),
	restify = require('restify'),
	cheerio = require('cheerio'),
	cache = require('restify-cache'),
	dotenv = require('dotenv'),
	semver = require('semver');

dotenv.load({ 'silent': true });

var server = restify.createServer({
	'name': 'Utah DABC API',
	'version': '1.0.0',
	'versions': ['1.0.0']
});

// allow path based API versioning
// based on https://stackoverflow.com/a/29706259
server.pre(function (req, res, next) {
	var pieces = req.url.replace(/^\/+/, '').split('/'),
		pathVersion = pieces[0],
		semVersion = semver.valid(pathVersion);

	// only if you want to use this routes:
	// /api/v1/resource
	// /api/v1.0/resource
	// /api/v1.0.0/resource
	if (!semVersion) {
		semVersion = pathVersion.replace(/v(\d{1})\.(\d{1})\.(\d{1})/, '$1.$2.$3');
		semVersion = semVersion.replace(/v(\d{1})\.(\d{1})/, '$1.$2.0');
		semVersion = semVersion.replace(/v(\d{1})/, '$1.0.0');
	}

	if (semver.valid(semVersion) && server.versions.indexOf(semVersion) > -1) {
		req.url = req.url.replace(pathVersion + '/', '');
		req.headers['accept-version'] = semVersion;
	}

	return next();
});

server.pre(restify.pre.sanitizePath());
server.use(cache.before);
server.on('after', cache.after);

var URL_BASE      = 'http://www.webapps.abc.utah.gov/Production',
	BEER_LIST_URL = '/OnlinePriceList/DisplayPriceList.aspx?DivCd=T',
	INVENTORY_URL = '/OnlineInventoryQuery/IQ/InventoryQuery.aspx';

function allBeers(req, apiResponse, next) {

	request(URL_BASE + BEER_LIST_URL, function(err, res, html) {

		if ( err ) {

			return next(err);

		}

		var inventory = [],
			colMap = ['description', 'div', 'dept', 'cat', 'size', 'cs_code', 'price', 'status'],
			$ = cheerio.load(html);

		$('#ctl00_ContentPlaceHolderBody_gvPricelist > tr').each(function(idx, row) {

			var $cols = $(row).find('td');

			if ( $cols.length ) {

				var beer = {};

				$cols.each(function(idx, td) {

					if ( idx in colMap ) {

						beer[colMap[idx]] = $(td).text();

					}

				});

				inventory.push(beer);

			}

		});

		apiResponse.send(inventory);

		next();

	});

}

function beerInventory(req, apiResponse, next) {

	apiResponse.cache({ 'maxAge': 60 * 60 * 2 });

	var csCode = req.params.cs_code;

	request(URL_BASE + INVENTORY_URL, function(err, res, html) {

		if ( err ) {
		
			return next(err);
		
		}

		var $ = cheerio.load(html);

		var VIEWSTATE = $('#__VIEWSTATE').val(),
			EVENTVALIDATION = $('#__EVENTVALIDATION').val();

		request.post(
			URL_BASE + INVENTORY_URL,
			{
				'headers': {
					'User-Agent': 'Mozilla'
				},
				'form': {
					'__VIEWSTATE': VIEWSTATE,
					'__EVENTVALIDATION': EVENTVALIDATION,
					'__ASYNCPOST': true,
					'ctl00$ContentPlaceHolderBody$tbCscCode': csCode
				}
			},
			function(err, res, html) {

				if ( err ) {

					return next(err);

				}

				var $ = cheerio.load(html);

				var inventory = {
					'sku': $('#ContentPlaceHolderBody_lblSku').text(),
					'status': $('#ContentPlaceHolderBody_lblStatus').text(),
					'price': $('#ContentPlaceHolderBody_lblPrice').text(),
					'description': $('#ContentPlaceHolderBody_lblDesc').text(),
					'warehouse': {
						'onOrder': parseInt( $('#ContentPlaceHolderBody_lblWhsOnOrder').text() ),
						'inventory': parseInt( $('#ContentPlaceHolderBody_lblWhsInv').text() )
					},
					'stores': []
				};

				var colMap = ['store', 'name', 'qty', 'address', 'city', 'phone'];

				$('#ContentPlaceHolderBody_gvInventoryDetails tr.gridViewRow').each(function(idx, row) {

					var store = {};

					$(row).find('td').each(function(idx, td) {

						store[colMap[idx]] = $(td).text();

					});

					store.qty = parseInt(store.qty);

					inventory.stores.push(store);

				});

				apiResponse.send(inventory);

				next();

			}
		);

	});

}

server.get({ 'path': '/beers', 'version': '1.0.0' }, allBeers);

server.get({ 'path': '/beers/:cs_code', 'version': '1.0.0' }, beerInventory);

server.listen(process.env.PORT || 8080, function() {
	console.log('%s listening at %s', server.name, server.url);
});