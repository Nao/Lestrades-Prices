// ==UserScript==
// @name         Lestrades GG.Deals Price Button (All Features + Special Items)
// @namespace    your-namespace
// @version      0.2
// @description Integrates GG.Deals prices into lestrades.com/matches pages, with monthly pruning, paging, search, spacing, adaptive time, auto-load fix, soft/hard load commands, and special item exceptions for Gems and Mann Co. keys.
// @match        https://lestrades.com/matches*
// @connect      gg.deals
// @connect      steamcommunity.com
// @connect      mannco.store
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       document-end
// @homepageURL  https://github.com/MrAwesomeFalcon/Lestrades-Enhancer/
// @supportURL   https://github.com/MrAwesomeFalcon/Lestrades-Enhancer/issues
// @downloadURL  https://github.com/MrAwesomeFalcon/Lestrades-Enhancer/raw/master/Lestrades-Enhancer.user.js
// @updateURL    https://github.com/MrAwesomeFalcon/Lestrades-Enhancer/raw/master/Lestrades-Enhancer.user.js
// ==/UserScript==

(function() {
    'use strict';

    // CONFIG
    const AUTO_CHECK_COUNT = 5; // autoload this many fresh items after scanning
    const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // one week freshness for normal items
    const SHOW_CACHED_IMMEDIATELY = true; // if true, show cached results right away if fresh
    const ITEMS_PER_PAGE = 50;
    const MONTH_MS = 30 * 24 * 60 * 60 * 1000; // prune entries older than 30 days
    const GAME_NAME_WIDTH = 70; // spacing for normalized display

    // Special items settings
    const SPECIAL_CACHE_DURATION = 24 * 60 * 60 * 1000; // 1 day cache for special items
    const SPECIAL_ITEMS = ["Gems", "Sack of Gems", "Mann Co. Supply Crate Key"];

    let cachedPrices = GM_getValue("cachedPrices", {});
    if (typeof cachedPrices !== 'object' || cachedPrices === null) {
        cachedPrices = {};
    }

    pruneOldEntries();

    GM_registerMenuCommand("View Cached Prices", viewCachedPrices);
    GM_registerMenuCommand("Clear Cached Prices", clearCachedPrices);
    GM_registerMenuCommand("Soft load (only missing)", softLoad);
    GM_registerMenuCommand("Hard load (refresh all)", hardLoad);

    let allItems = [];
    let freshGames = [];

    window.addEventListener('load', initLestrades);

    function initLestrades() {
        const traderHeadings = document.querySelectorAll("h1.trader");
        const now = Date.now();

        traderHeadings.forEach((heading) => {
            const matchesTable = heading.nextElementSibling;
            if (!matchesTable || !matchesTable.matches("table.matches")) return;

            const gameLinks = matchesTable.querySelectorAll("td a[href^='/game/']");
            gameLinks.forEach((link) => {
                const gameName = link.textContent.trim();
                const btnId = `ggdeals_btn_${Math.random().toString(36).substr(2,9)}`;

                const container = document.createElement('span');
                container.className = 'ggdeals-container';
                container.style.marginLeft = '5px';
                container.innerHTML = `
                    <a id="${btnId}" style="cursor: pointer;">
                        <img src="https://bartervg.com/imgs/ico/gg.png" width="14" height="14" title="GG.Deals: Click to load price info!">
                    </a>
                    <small id="${btnId}_after"></small>
                `;
                link.insertAdjacentElement('afterend', container);

                allItems.push({gameName, btnId});

                const btnElem = document.getElementById(btnId);
                btnElem.addEventListener('click', () => {
                    getCachedOrFetchPrice(gameName, (priceInfo) => {
                        const resultElem = document.getElementById(`${btnId}_after`);
                        resultElem.innerHTML = ` (<a href="${getItemURL(gameName)}" target="_blank">${priceInfo}</a>)`;
                    });
                });

                const cached = cachedPrices[gameName];
                if (SHOW_CACHED_IMMEDIATELY && cached && isCacheFresh(gameName, cached.timestamp)) {
                    // show cached right away
                    const resultElem = document.getElementById(`${btnId}_after`);
                    resultElem.innerHTML = ` (<a href="${getItemURL(gameName)}" target="_blank">${cached.price}</a>)`;
                } else if (!cached) {
                    // no cached data => fresh game
                    freshGames.push({btnId, gameName});
                } else if (cached && !isCacheFresh(gameName, cached.timestamp)) {
                    // expired cache => fresh again
                    freshGames.push({btnId, gameName});
                }
            });
        });

        // Autoload fresh items if AUTO_CHECK_COUNT > 0
        if (AUTO_CHECK_COUNT > 0 && freshGames.length > 0) {
            const limit = Math.min(AUTO_CHECK_COUNT, freshGames.length);
            for (let i = 0; i < limit; i++) {
                setTimeout(() => {
                    const elem = document.getElementById(freshGames[i].btnId);
                    if (elem) elem.click();
                }, 500 * i);
            }
        }
    }

    function viewCachedPrices() {
        const now = Date.now();
        const allEntries = Object.entries(cachedPrices).map(([gameName, data]) => {
            const ageMs = now - data.timestamp;
            const ageStr = formatAge(ageMs);
            const url = getItemURL(gameName);
            return { gameName, price: data.price, ageStr, url };
        });

        // Put special items on top
        const special = allEntries.filter(e => SPECIAL_ITEMS.includes(e.gameName));
        const normal = allEntries.filter(e => !SPECIAL_ITEMS.includes(e.gameName));
        const sortedEntries = [...special, ...normal];

        showPagedPopup(sortedEntries);
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
        searchInput.placeholder = 'Search game name...';
        searchInput.style.marginRight = '5px';
        const searchButton = document.createElement('button');
        searchButton.textContent = 'Search';
        searchButton.style.marginRight = '5px';

        const clearButton = document.createElement('button');
        clearButton.textContent = 'Clear';

        searchButton.addEventListener('click', () => {
            const query = searchInput.value.trim().toLowerCase();
            if (query) {
                filteredEntries = allEntries.filter(e => e.gameName.toLowerCase().includes(query));
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

            const lines = pageItems.map(e => formatLine(e.gameName, e.price, e.ageStr, e.url));
            resultsDiv.innerHTML = `<pre>${lines.join('\n')}</pre>`;
        }

        renderPage();
    }

    function formatLine(gameName, price, ageStr, url) {
        let displayPrice = price;
        // Special formatting for Gems/Sack of Gems
        if (gameName === "Gems" || gameName === "Sack of Gems") {
            // If price is something like $0.50, convert to $0.50/1000
            // Assuming price always starts with $, parse it:
            // Price might be "No price found" or something else. Check if it starts with $
            if (displayPrice.startsWith('$')) {
                displayPrice = displayPrice + "/1000";
            }
        }

        let fullName = gameName; // no trailing ':'
        fullName = padRight(fullName, GAME_NAME_WIDTH);
        return `${fullName} ${displayPrice} (Age: ${ageStr}) ${urlLink("GG Deals", url)}`;
    }

    function urlLink(text, url) {
        return `<a href="${url}" target="_blank">${text}</a>`;
    }

    function padRight(str, length) {
        if (str.length < length) {
            return str + ' '.repeat(length - str.length);
        } else {
            return str;
        }
    }

    function clearCachedPrices() {
        if (confirm("Are you sure you want to clear all cached prices?")) {
            cachedPrices = {};
            GM_setValue("cachedPrices", cachedPrices);
            alert("Cached prices cleared.");
        }
    }

    function softLoad() {
        const now = Date.now();
        allItems.forEach(item => {
            const {gameName, btnId} = item;
            const cached = cachedPrices[gameName];
            let shouldLoad = false;
            if (!SHOW_CACHED_IMMEDIATELY) {
                // If display off, load all
                shouldLoad = true;
            } else {
                // If display on, only load missing (no cached or expired or no price found)
                if (!cached || !isCacheFresh(gameName, cached.timestamp) || cached.price === "No price found") {
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
        // Force refresh all items from their respective sources
        allItems.forEach(item => {
            const {gameName, btnId} = item;
            fetchItemPrice(gameName, (priceInfo) => {
                if (priceInfo !== "No price found") {
                    cachedPrices[gameName] = {
                        price: priceInfo,
                        timestamp: Date.now()
                    };
                    GM_setValue("cachedPrices", cachedPrices);
                }
                const resultElem = document.getElementById(`${btnId}_after`);
                if (resultElem) {
                    resultElem.innerHTML = ` (<a href="${getItemURL(gameName)}" target="_blank">${priceInfo}</a>)`;
                }
            });
        });
    }

    function getCachedOrFetchPrice(gameName, callback) {
        const now = Date.now();
        const cached = cachedPrices[gameName];

        if (cached && isCacheFresh(gameName, cached.timestamp)) {
            callback(cached.price);
        } else {
            fetchItemPrice(gameName, (priceInfo) => {
                if (priceInfo !== "No price found") {
                    cachedPrices[gameName] = {
                        price: priceInfo,
                        timestamp: Date.now()
                    };
                    GM_setValue("cachedPrices", cachedPrices);
                }
                callback(priceInfo);
            });
        }
    }

function fetchItemPrice(gameName, callback) {
    if (gameName === "Gems" || gameName === "Sack of Gems") {
        // Fetch from Steam Community Market
        const url = `https://steamcommunity.com/market/listings/753/753-Sack%20of%20Gems`;
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: (response) => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, "text/html");
                // Attempt to find the price using the specific selector
                let priceElem = doc.querySelector(".market_commodity_orders_header_promote");
                let price = priceElem ? priceElem.textContent.trim() : "No price found";

                // Fallback logic if the selector fails
                if (price === "No price found") {
                    const alternativeElem = doc.querySelector(".market_listing_price");
                    if (alternativeElem) {
                        price = alternativeElem.textContent.trim();
                    }
                }

                // Final callback with the fetched or default price
                callback(price);
            },
            onerror: () => callback("No price found"),
            ontimeout: () => callback("No price found")
        });
        return;
    } else if (gameName === "Mann Co. Supply Crate Key") {
        // Fetch from Mannco.store
        const url = `https://mannco.store/item/440-mann-co-supply-crate-key`;
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: (response) => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, "text/html");
                let priceElem = doc.querySelector(".ecurrency");
                let price = priceElem ? priceElem.textContent.trim() : "No price found";
                callback(price);
            },
            onerror: () => callback("No price found"),
            ontimeout: () => callback("No price found")
        });
        return;
    } else {
        // Normal item from GG.Deals
        const url = `https://gg.deals/search/?platform=1,2,4,2048,4096,8192&title=${encodeURIComponent(gameName)}`;
        GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: (response) => {
                const parser = new DOMParser();
                const doc = parser.parseFromString(response.responseText, "text/html");
                let priceElem = doc.querySelector(".price-inner.numeric");
                let price = priceElem ? priceElem.textContent.trim() : "No price found";
                callback(price);
            },
            onerror: () => callback("No price found"),
            ontimeout: () => callback("No price found")
        });
    }
}


    function getItemURL(gameName) {
        if (gameName === "Gems" || gameName === "Sack of Gems") {
            return `https://steamcommunity.com/market/listings/753/753-Sack%20of%20Gems`;
        } else if (gameName === "Mann Co. Supply Crate Key") {
            return `https://mannco.store/item/440-mann-co-supply-crate-key`;
        } else {
            return `https://gg.deals/search/?platform=1,2,4,2048,4096,8192&title=${encodeURIComponent(gameName)}`;
        }
    }

    function isCacheFresh(gameName, timestamp) {
        const now = Date.now();
        const age = now - timestamp;
        if (gameName === "Gems" || gameName === "Sack of Gems" || gameName === "Mann Co. Supply Crate Key") {
            return age < SPECIAL_CACHE_DURATION; // 1 day for special items
        } else {
            return age < CACHE_DURATION; // normal items
        }
    }

    function softLoad() {
        const now = Date.now();
        allItems.forEach(item => {
            const {gameName, btnId} = item;
            const cached = cachedPrices[gameName];
            let shouldLoad = false;
            if (!SHOW_CACHED_IMMEDIATELY) {
                // If display off, load all
                shouldLoad = true;
            } else {
                // If display on, only load missing (no cached or expired or no price found)
                if (!cached || !isCacheFresh(gameName, cached.timestamp) || cached.price === "No price found") {
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
        // Force refresh all items
        allItems.forEach(item => {
            const {gameName, btnId} = item;
            fetchItemPrice(gameName, (priceInfo) => {
                if (priceInfo !== "No price found") {
                    cachedPrices[gameName] = {
                        price: priceInfo,
                        timestamp: Date.now()
                    };
                    GM_setValue("cachedPrices", cachedPrices);
                }
                const resultElem = document.getElementById(`${btnId}_after`);
                if (resultElem) {
                    resultElem.innerHTML = ` (<a href="${getItemURL(gameName)}" target="_blank">${priceInfo}</a>)`;
                }
            });
        });
    }

    function pruneOldEntries() {
        const now = Date.now();
        let changed = false;
        for (const [gameName, data] of Object.entries(cachedPrices)) {
            if ((now - data.timestamp) > MONTH_MS) {
                delete cachedPrices[gameName];
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
        } else {
            return `${ageInDays.toFixed(2)} days`;
        }
    }

    function showCustomPopup(title, htmlContent) {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
        overlay.style.zIndex = '999999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';

        const popup = document.createElement('div');
        popup.style.background = '#333';
        popup.style.color = '#fff';
        popup.style.padding = '20px';
        popup.style.borderRadius = '8px';
        popup.style.width = '80%';
        popup.style.maxHeight = '80%';
        popup.style.overflowY = 'auto';
        popup.style.boxSizing = 'border-box';
        popup.style.position = 'relative';
        popup.style.fontFamily = 'monospace';

        const closeXButton = document.createElement('button');
        closeXButton.textContent = '✖';
        closeXButton.style.position = 'absolute';
        closeXButton.style.top = '10px';
        closeXButton.style.right = '10px';
        closeXButton.style.background = 'transparent';
        closeXButton.style.color = '#fff';
        closeXButton.style.border = 'none';
        closeXButton.style.fontSize = '20px';
        closeXButton.style.cursor = 'pointer';
        closeXButton.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        popup.appendChild(closeXButton);

        const h1 = document.createElement('h1');
        h1.textContent = title;
        h1.style.marginTop = '0';
        h1.style.paddingRight = '30px';
        popup.appendChild(h1);

        const content = document.createElement('div');
        content.style.whiteSpace = 'pre-wrap';
        content.style.wordBreak = 'break-word';
        content.innerHTML = htmlContent;
        popup.appendChild(content);

        const closeButton = document.createElement('button');
        closeButton.textContent = 'Close';
        closeButton.style.marginTop = '10px';
        closeButton.style.background = '#555';
        closeButton.style.color = '#fff';
        closeButton.style.border = 'none';
        closeButton.style.padding = '5px 10px';
        closeButton.style.cursor = 'pointer';
        closeButton.addEventListener('click', () => {
            document.body.removeChild(overlay);
        });
        popup.appendChild(closeButton);

        overlay.appendChild(popup);
        document.body.appendChild(overlay);
    }

})();
