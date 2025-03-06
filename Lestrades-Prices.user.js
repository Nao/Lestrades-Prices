// ==UserScript==
// @name			Lestrade's Prices
// @namespace		https://lestrades.com
// @version			0.69
// @description 	Integrates GG.Deals prices on Lestrades.com with caching, rate limiting, special-item handling, and one-click price lookups.
// @match			https://lestrades.com/*
// @connect			gg.deals
// @connect			steamcommunity.com
// @connect			mannco.store
// @grant			GM_xmlhttpRequest
// @grant			GM_setValue
// @grant			GM_getValue
// @grant			GM_registerMenuCommand
// @grant			GM_addStyle
// @run-at			document-end
// @homepageURL		https://github.com/Nao/Lestrades-Prices/
// @supportURL		https://github.com/Nao/Lestrades-Prices/issues
// @downloadURL		https://github.com/Nao/Lestrades-Prices/raw/refs/heads/main/Lestrades-Prices.user.js
// @updateURL		https://github.com/Nao/Lestrades-Prices/raw/refs/heads/main/Lestrades-Prices.user.js
// ==/UserScript==

// Original author: MrAwesomeFalcon
// Fiddled with by: Nao

(function() {
	'use strict';

	// CONFIG
	const AUTO_CHECK_COUNT = 0; // number of prices to automatically check every page load. CAREFUL this will almost certainly rate limit you immediately.
	const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // one week
	const SHOW_CACHED_IMMEDIATELY = true; // load items from the cache
	const ITEMS_PER_PAGE = 50; // items per page in the cache view
	const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
	const GAME_NAME_WIDTH = 70; // width of game names for making cache view look nicer
	const ICON_URL = 'https://i.imgur.com/s4oAJ1k.png'; // url used for the button icon. https://imgur.com/a/dTvpB2K for more icons made by Falc
	const PRICE_NOLD = 'No LD';
	const PRICE_ERROR = 'Error';

	// Special items settings
	const SPECIAL_CACHE_DURATION = 24 * 60 * 60 * 1000;
	const SPECIAL_ITEMS = ["Gems", "Sack of Gems", "Mann Co. Supply Crate Key"];

	// REQUEST QUEUE TO LIMIT RATE (10 requests/minute => 1 request/6 seconds)
	const REQUEST_INTERVAL_MS = 6000; // 6 seconds between each request, gg.deals allows 10 requests a minute, this should help stay within that limit.
	let requestQueue = [];
	setTimeout(execRequest, 1000); // Do it a first time once we have a chance to fill in that queue.
	setInterval(execRequest, REQUEST_INTERVAL_MS);

	GM_addStyle(`
		.ggdeals-price-container {
			display: inline-block !important;
			position: relative;
			margin: 0 4px 4px 3px;
			top: 3px;
		}
		.ggdeals-price-container * {
			line-height: 1 !important;
		}
		.ggdeals-price-container small {
			position: relative;
			top: -3px;
		}
	`);

	let cachedPrices = GM_getValue("cachedPrices", {});
	if (typeof cachedPrices !== 'object' || cachedPrices === null) {
		cachedPrices = {};
	}

	pruneOldEntries();

	GM_registerMenuCommand("View Cached Prices", viewCachedPrices);
	GM_registerMenuCommand("Clear Cached Prices", clearCachedPrices);
	GM_registerMenuCommand("Soft load (only missing)", softLoad);
	GM_registerMenuCommand("Hard load (refresh all)", hardLoad);

	// We'll keep arrays to track name-based items vs. appid-based items
	let allItems = []; // name-based
	let freshGames = [];
	let appItems = []; // appid-based
	let freshApps = [];

	window.addEventListener('load', init);

	function init() {
		// 1) Normal /game/ links scanning
		scanLestrades();

		// 2) Auto-load if desired
		maybeAutoLoadFresh();
	}

	function execRequest() {
		if (requestQueue.length)
			GM_xmlhttpRequest(requestQueue.shift());
	}

	function queueGMRequest(req) { requestQueue.push(req); }

	function link_me(btnId, link, text)
	{
		const btn = document.getElementById(btnId + '_after');
		if (btn !== null)
			btn.innerHTML = ' (<a href="' + link + '" target="_blank" style="text-decoration:none;">' + (text.indexOf('|') >= 0 ? (text.split('|')[0] + ' ' + text.split('|')[1] / 100) : text) + '</a>)';
	}

	// -------------------------------------------------------------------------
	// 1) Scanning for app IDs across Lestrade's
	// -------------------------------------------------------------------------
	function scanLestrades() {
		const gameLinks = document.querySelectorAll("a[data-appid], a[data-subid]");
		gameLinks.forEach((link) => {
			const gameName = link.textContent.trim();
			const appIdFromLink = link.getAttribute('data-appid') ? 'app/' + link.getAttribute('data-appid') : 'sub/' + link.getAttribute('data-subid');
			const btnId = `ggdeals_btn_${Math.random().toString(36).substr(2,9)}`;
			link.removeAttribute('data-appid');
			link.removeAttribute('data-subid');

			const container = document.createElement('span');
			container.classList.add('ggdeals-price-container');
			container.innerHTML = `
				<a id="${btnId}" style="cursor: pointer; border:none; outline:none; background:transparent; text-decoration:none;">
					<img src="${ICON_URL}" width="14" height="14"
						 title="GG.Deals: Click to load/update price info!"
						 style="border:none; outline:none; background:transparent;"/>
				</a>
				<small id="${btnId}_after"></small>
			`;
			link.insertAdjacentElement('afterend', container);

			if (appIdFromLink && !isNaN(appIdFromLink.substr(4))) {
				// AppID-based item
				appItems.push({ appId: appIdFromLink, btnId });

				// Always refetch on click
				const btnElem = document.getElementById(btnId);
				btnElem.addEventListener('click', () => {
					fetchItemPriceByAppId(appIdFromLink, (priceInfo, gameTitle) => {
						storeInCacheByAppId(appIdFromLink, priceInfo, gameTitle);
						link_me(btnId, getItemURLByAppId(appIdFromLink), priceInfo);
					});
					window.unsafeWindow._ignor_clic = true;
				});

				// Show cached if fresh or mark as needed
				const cached = cachedPrices[appIdFromLink];
				if (SHOW_CACHED_IMMEDIATELY && cached && isCacheFresh(cached.name || appIdFromLink, cached.timestamp)) {
					link_me(btnId, getItemURLByAppId(appIdFromLink), cached.price);
				} else if (!cached) {
					freshApps.push({ btnId, appId: appIdFromLink });
				} else if (!isCacheFresh(cached.name || appIdFromLink, cached.timestamp)) {
					freshApps.push({ btnId, appId: appIdFromLink });
				}
			} else {
				// Name-based item
				allItems.push({ gameName, btnId });

				// Always refetch on click
				const btnElem = document.getElementById(btnId);
				btnElem.addEventListener('click', () => {
					fetchItemPriceByName(gameName, (priceInfo, foundName, foundAppId) => {
						storeInCache(gameName, priceInfo, foundName, foundAppId);
						link_me(btnId, foundAppId ? getItemURLByAppId(foundAppId) : getItemURL(foundName || gameName), priceInfo);
					});
					window.unsafeWindow._ignor_clic = true;
				});

				const cached = cachedPrices[gameName];
				if (SHOW_CACHED_IMMEDIATELY && cached && isCacheFresh(cached.name || gameName, cached.timestamp)) {
					link_me(btnId, getItemURL(gameName), cached.price);
				} else if (!cached) {
					freshGames.push({ btnId, gameName });
				} else if (cached && !isCacheFresh(cached.name || gameName, cached.timestamp)) {
					freshGames.push({ btnId, gameName });
				}
			}
		});

		// Auto-click the single priority entry on any page -- but only after 5 seconds, to avoid overloading the server.
		setTimeout(() => {
			if (document.querySelector('#gg-priority')) {
				document.querySelector('#gg-priority + span > a').click();
				window.unsafeWindow._ignor_clic = false;
			}
		}, 5000);
	}

	// -------------------------------------------------------------------------
	// 2) Auto-load logic
	// -------------------------------------------------------------------------
	function maybeAutoLoadFresh() {
		// Autoload fresh name-based items
		if (AUTO_CHECK_COUNT > 0 && freshGames.length > 0) {
			const limit = Math.min(AUTO_CHECK_COUNT, freshGames.length);
			for (let i = 0; i < limit; i++) {
				setTimeout(() => {
					const elem = document.getElementById(freshGames[i].btnId);
					if (elem) elem.click();
				}, 500 * i);
			}
		}

		// Autoload fresh app-based items
		if (AUTO_CHECK_COUNT > 0 && freshApps.length > 0) {
			const limit = Math.min(AUTO_CHECK_COUNT, freshApps.length);
			for (let i = 0; i < limit; i++) {
				setTimeout(() => {
					const elem = document.getElementById(freshApps[i].btnId);
					if (elem) elem.click();
				}, 500 * i);
			}
		}
	}

	// -------------------------------------------------------------------------
	// Menu commands: cache view, soft/hard load, etc.
	// -------------------------------------------------------------------------
	function viewCachedPrices() {
		const now = Date.now();
		const allEntries = Object.entries(cachedPrices).map(([key, data]) => {
			const ageMs = now - data.timestamp;
			const ageStr = formatAge(ageMs);
			const isAppId = !isNaN(key.substr(4));
			let usedName = data.name || key;
			const url = data.appid ? getItemURLByAppId(data.appid) : getItemURL(usedName);

			return {
				gameName: usedName,
				price: data.price,
				ageStr,
				url,
				appid: data.appid || (isAppId ? key : null)
			};
		});

		// Sort by gameName alphabetically
		allEntries.sort((a, b) => a.gameName.localeCompare(b.gameName));
		showPagedPopup(allEntries);
	}

	function showPagedPopup(allEntries) {
		let currentPage = 0;
		let filteredEntries = [...allEntries];
		const totalPages = () => Math.ceil(filteredEntries.length / ITEMS_PER_PAGE);

		const overlay = document.createElement('div');
		overlay.style = `
			position: fixed; top:0; left:0; width:100%; height:100%;
			background-color: rgba(0,0,0,0.7); z-index:999999; display:flex;
			align-items:center; justify-content:center;
		`;

		const popup = document.createElement('div');
		popup.style = `
			background:#333; color:#fff; padding:20px; border-radius:8px; width:80%;
			max-height:80%; overflow-y:auto; box-sizing:border-box; position:relative;
			font-family: monospace;
		`;

		const closeXButton = document.createElement('button');
		closeXButton.textContent = '✖';
		closeXButton.style = `
			position:absolute; top:10px; right:10px; background:transparent; color:#fff;
			border:none; font-size:20px; cursor:pointer;
		`;
		closeXButton.addEventListener('click', () => document.body.removeChild(overlay));
		popup.appendChild(closeXButton);

		const h1 = document.createElement('h1');
		h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
		h1.style.marginTop = '0';
		h1.style.paddingRight = '30px';
		popup.appendChild(h1);

		// Search bar
		const searchDiv = document.createElement('div');
		searchDiv.style.marginBottom = '10px';
		const searchInput = document.createElement('input');
		searchInput.type = 'text';
		searchInput.placeholder = 'Search game name or appid...';
		searchInput.style.marginRight = '5px';

		const searchButton = document.createElement('button');
		searchButton.textContent = 'Search';
		searchButton.style.marginRight = '5px';

		const clearButton = document.createElement('button');
		clearButton.textContent = 'Clear';

		searchButton.addEventListener('click', () => {
			const query = searchInput.value.trim().toLowerCase();
			if (query) {
				filteredEntries = allEntries.filter(e =>
					e.gameName.toLowerCase().includes(query) ||
					(e.appid && e.appid.toString().includes(query))
				);
			} else {
				filteredEntries = [...allEntries];
			}
			currentPage = 0;
			renderPage();
			h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
		});

		clearButton.addEventListener('click', () => {
			searchInput.value = '';
			filteredEntries = [...allEntries];
			currentPage = 0;
			renderPage();
			h1.textContent = `Cached Prices (${filteredEntries.length} cached items)`;
		});

		searchDiv.appendChild(searchInput);
		searchDiv.appendChild(searchButton);
		searchDiv.appendChild(clearButton);
		popup.appendChild(searchDiv);

		const resultsDiv = document.createElement('div');
		popup.appendChild(resultsDiv);

		const paginationDiv = document.createElement('div');
		paginationDiv.style.marginTop = '10px';

		const prevButton = document.createElement('button');
		prevButton.textContent = 'Previous';
		prevButton.style.marginRight = '5px';

		const nextButton = document.createElement('button');
		nextButton.textContent = 'Next';

		prevButton.addEventListener('click', () => {
			if (currentPage > 0) {
				currentPage--;
				renderPage();
			}
		});
		nextButton.addEventListener('click', () => {
			if (currentPage < totalPages() - 1) {
				currentPage++;
				renderPage();
			}
		});

		paginationDiv.appendChild(prevButton);
		paginationDiv.appendChild(nextButton);
		popup.appendChild(paginationDiv);

		const closeButton = document.createElement('button');
		closeButton.textContent = 'Close';
		closeButton.style = `
			margin-top:10px; background:#555; color:#fff; border:none;
			padding:5px 10px; cursor:pointer;
		`;
		closeButton.addEventListener('click', () => {
			document.body.removeChild(overlay);
		});
		popup.appendChild(closeButton);

		overlay.appendChild(popup);
		document.body.appendChild(overlay);

		function renderPage() {
			resultsDiv.innerHTML = '';
			const start = currentPage * ITEMS_PER_PAGE;
			const end = start + ITEMS_PER_PAGE;
			const pageItems = filteredEntries.slice(start, end);
			if (pageItems.length === 0) {
				resultsDiv.innerHTML = 'No results.';
				return;
			}

			const lines = pageItems.map(e =>
				formatLine(e.gameName, e.price, e.ageStr, e.url, e.appid)
			);
			resultsDiv.innerHTML = `<pre>${lines.join('\n')}</pre>`;
		}

		renderPage();
	}

	function formatLine(gameName, price, ageStr, url, appid) {
		let displayPrice = price;
		const nameLower = gameName.toLowerCase();
		if ((nameLower.includes("gems") || nameLower.includes("sack of gems")) && displayPrice.startsWith('$')) {
			displayPrice += "/1000";
		}

		let fullName = padRight(gameName, GAME_NAME_WIDTH);
		// Reserve space for AppID block: 9 chars "[1230530]" or "[	   ]"
		if (appid) {
			fullName += ` [${appid}]`;
		} else {
			fullName += ` [	   ]`;
		}

		return `${fullName} ${displayPrice} (Age: ${ageStr}) ${urlLink("GG Deals", url)}`;
	}

	function urlLink(text, url) {
		return `<a href="${url}" target="_blank">${text}</a>`;
	}

	function padRight(str, length) {
		if (str.length < length) {
			return str + ' '.repeat(length - str.length);
		}
		return str;
	}

	function clearCachedPrices() {
		if (confirm("Are you sure you want to clear all cached prices?")) {
			cachedPrices = {};
			GM_setValue("cachedPrices", cachedPrices);
			alert("Cached prices cleared.");
		}
	}

	function softLoad() {
		// For name-based items
		allItems.forEach(item => {
			const { gameName, btnId } = item;
			const cached = cachedPrices[gameName];
			let shouldLoad = false;
			if (!SHOW_CACHED_IMMEDIATELY) {
				shouldLoad = true;
			} else {
				if (!cached || !isCacheFresh(cached.name || gameName, cached.timestamp) || cached.price === PRICE_ERROR) {
					shouldLoad = true;
				}
			}
			if (shouldLoad) {
				const elem = document.getElementById(btnId);
				if (elem) elem.click();
			}
		});

		// For appId items
		appItems.forEach(item => {
			const { appId, btnId } = item;
			const cached = cachedPrices[appId];
			let shouldLoad = false;
			if (!SHOW_CACHED_IMMEDIATELY) {
				shouldLoad = true;
			} else {
				if (!cached || !isCacheFresh(cached.name || appId, cached.timestamp) || cached.price === PRICE_ERROR) {
					shouldLoad = true;
				}
			}
			if (shouldLoad) {
				const elem = document.getElementById(btnId);
				if (elem) elem.click();
			}
		});
	}

	function hardLoad() {
		// For name-based items
		allItems.forEach(item => {
			const { gameName, btnId } = item;
			fetchItemPriceByName(gameName, (priceInfo, foundName, foundAppId) => {
				storeInCache(gameName, priceInfo, foundName, foundAppId);
				link_me(btnId, foundAppId ? getItemURLByAppId(foundAppId) : getItemURL(foundName || gameName), priceInfo);
			});
		});

		// For appId items
		appItems.forEach(item => {
			const { appId, btnId } = item;
			fetchItemPriceByAppId(appId, (priceInfo, gameTitle) => {
				storeInCacheByAppId(appId, priceInfo, gameTitle);
				link_me(btnId, getItemURLByAppId(appId), priceInfo);
			});
		});
	}

	// -------------------------------------------------------------------------
	// Storing in cache
	// -------------------------------------------------------------------------
	function storeInCache(gameName, priceInfo, foundName, foundAppId) {
		if (foundAppId) {
			// If we used to store by gameName, remove that entry
			if (cachedPrices[gameName] && cachedPrices[gameName].appid !== foundAppId) {
				delete cachedPrices[gameName];
			}
			// Store by appId only
			cachedPrices[foundAppId] = {
				price: priceInfo,
				name: foundName || gameName,
				appid: foundAppId,
				timestamp: Date.now()
			};
			if (document.querySelector('#wedge') && foundAppId)
				GM_xmlhttpRequest({
					method: 'POST',
					url: 'https://lestrades.com/?action=ajax;sa=gg',
					data: 'gg=' + encodeURI(priceInfo) + '&app=' + foundAppId + '&' + window.unsafeWindow.we_sessvar + '=' + window.unsafeWindow.we_sessid,
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
				});
		} else {
			// No appid
			cachedPrices[gameName] = {
				price: priceInfo,
				name: foundName || gameName,
				timestamp: Date.now()
			};
		}
		GM_setValue("cachedPrices", cachedPrices);
	}

	function storeInCacheByAppId(appId, priceInfo, gameTitle) {
		// If previously stored by name, remove that entry
		for (const [key, val] of Object.entries(cachedPrices)) {
			if (key !== appId && val.appid === appId) {
				delete cachedPrices[key];
			}
		}
		cachedPrices[appId] = {
			price: priceInfo,
			name: gameTitle || appId,
			appid: appId,
			timestamp: Date.now()
		};
		GM_setValue("cachedPrices", cachedPrices);
		if (document.querySelector('#wedge'))
			GM_xmlhttpRequest({
				method: 'POST',
				url: 'https://lestrades.com/?action=ajax;sa=gg',
				data: 'gg=' + encodeURI(priceInfo) + '&app=' + appId + '&' + window.unsafeWindow.we_sessvar + '=' + window.unsafeWindow.we_sessid,
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
			});
	}

	// Get all cheapest official & keyshop entries with a Steam DRM, then extract the price from the descendant span. Also include currency information! (Note: should we separate official from keyshop prices?)
	function getPricesFromDOM(doc)
	{
		const ld = doc.querySelector('script[type="application/ld+json"]');
		if (ld === null) return PRICE_NOLD;
		const prices = doc.querySelectorAll(':is(#keyshops, #official-stores) .similar-deals-container:has(svg.svg-icon-drm-steam) .price-inner');
		// GG prices always have 2 decimal digits, so just remove all non-digit chars, giving us a price in cents, and keep the smallest result!
		const price = Math.min(...Array.from(prices).map(el => el.textContent.replace(/[^\d]/g, '')));
		if (/\d+/.test(price)) return (JSON.parse(ld.innerText)?.offers?.priceCurrency || 'LTS') + '|' + price;
		return PRICE_ERROR;
	}

	// -------------------------------------------------------------------------
	// Fetch logic (always fresh on manual click)
	// -------------------------------------------------------------------------
	function fetchItemPriceByName(gameName, callback) {
		if (gameName === "Gems" || gameName === "Sack of Gems") {
			const url = `https://steamcommunity.com/market/listings/753/753-Sack%20of%20Gems`;
			GM_xmlhttpRequest({
				method: "GET",
				url: url,
				onload: (response) => {
					const parser = new DOMParser();
					const doc = parser.parseFromString(response.responseText, "text/html");

					let priceElem = doc.querySelector(".market_commodity_orders_header_promote");
					let price = priceElem ? priceElem.textContent.trim() : PRICE_ERROR;
					if (price === PRICE_ERROR) {
						const alternativeElem = doc.querySelector(".market_listing_price");
						if (alternativeElem) {
							price = alternativeElem.textContent.trim();
						}
					}
					callback(price, gameName, null);
				},
				onerror: () => callback(PRICE_ERROR, gameName, null),
				ontimeout: () => callback(PRICE_ERROR, gameName, null)
			});
			return;
		} else if (gameName === "Mann Co. Supply Crate Key") {
			const url = `https://mannco.store/item/440-mann-co-supply-crate-key`;
			GM_xmlhttpRequest({
				method: "GET",
				url: url,
				onload: (response) => {
					const parser = new DOMParser();
					const doc = parser.parseFromString(response.responseText, "text/html");

					let priceElem = doc.querySelector(".ecurrency");
					let price = priceElem ? priceElem.textContent.trim() : PRICE_ERROR;
					callback(price, gameName, null);
				},
				onerror: () => callback(PRICE_ERROR, gameName, null),
				ontimeout: () => callback(PRICE_ERROR, gameName, null)
			});
			return;
		}

		const url = `https://gg.deals/search/?platform=1,2,4,2048,4096,8192&title=${encodeURIComponent(gameName)}`;
		queueGMRequest({
			method: 'GET',
			url: url,
			onload: (response) => {
				const parser = new DOMParser();
				const doc = parser.parseFromString(response.responseText, 'text/html');

				let price = getPricesFromDOM(doc);

				let foundName = null;
				let foundAppId = null;
				const firstResultLink = doc.querySelector('.game-info-title[href*="/steam/app/"]');
				if (firstResultLink) {
					const href = firstResultLink.getAttribute('href');
					const appIdMatch = href.match(/\/steam\/((?:app|sub)\/\d+)\//);
					if (appIdMatch) {
						foundAppId = appIdMatch[1];
					}
					const nameElem = firstResultLink.querySelector('[itemprop="name"]');
					if (nameElem) {
						foundName = nameElem.textContent.trim();
					}
				}
				callback(price, foundName || gameName, foundAppId);
			},
			onerror: () => callback(PRICE_ERROR, gameName, null),
			ontimeout: () => callback(PRICE_ERROR, gameName, null)
		});
	}

	function fetchItemPriceByAppId(appId, callback) {
		const url = `https://gg.deals/steam/${appId}/`;
		queueGMRequest({
			method: "GET",
			url: url,
			onload: (response) => {
				const parser = new DOMParser();
				const doc = parser.parseFromString(response.responseText, 'text/html');

				let price = getPricesFromDOM(doc);

				let nameElem = doc.querySelector('a[itemprop="item"].active span[itemprop="name"]');
				let gameTitle = nameElem ? nameElem.textContent.trim() : null;

				callback(price, gameTitle);
			},
			onerror: () => callback(PRICE_ERROR, null),
			ontimeout: () => callback(PRICE_ERROR, null)
		});
	}

	// -------------------------------------------------------------------------
	// URL helpers
	// -------------------------------------------------------------------------
	function getItemURL(gameName) {
		if (gameName === "Gems" || gameName === "Sack of Gems") {
			return `https://steamcommunity.com/market/listings/753/753-Sack%20of%20Gems`;
		} else if (gameName === "Mann Co. Supply Crate Key") {
			return `https://mannco.store/item/440-mann-co-supply-crate-key`;
		}
		return `https://gg.deals/search/?platform=1,2,4,2048,4096,8192&title=${encodeURIComponent(gameName)}`;
	}

	function getItemURLByAppId(appId) {
		return `https://gg.deals/steam/${appId}/`;
	}

	// -------------------------------------------------------------------------
	// Freshness / pruning
	// -------------------------------------------------------------------------
	function isCacheFresh(gameNameOrId, timestamp) {
		const nameLower = (gameNameOrId + "").toLowerCase();
		const now = Date.now();
		const age = now - timestamp;
		if (SPECIAL_ITEMS.some(item => item.toLowerCase() === nameLower)) {
			return age < SPECIAL_CACHE_DURATION;
		}
		return age < CACHE_DURATION;
	}

	function pruneOldEntries() {
		const now = Date.now();
		let changed = false;
		for (const [key, data] of Object.entries(cachedPrices)) {
			if ((now - data.timestamp) > MONTH_MS) {
				delete cachedPrices[key];
				changed = true;
			}
		}
		if (changed) {
			GM_setValue("cachedPrices", cachedPrices);
		}
	}

	function formatAge(ms) {
		const ageInDays = ms / (1000*60*60*24);
		const ageInHours = ageInDays * 24;
		const ageInMinutes = ageInHours * 60;

		if (ageInHours < 1) {
			return `${ageInMinutes.toFixed(2)} minutes`;
		} else if (ageInHours < 24) {
			return `${ageInHours.toFixed(2)} hours`;
		}
		return `${ageInDays.toFixed(2)} days`;
	}
})();
