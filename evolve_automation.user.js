// ==UserScript==
// @name         Evolve
// @namespace    http://tampermonkey.net/
// @version      1.0.2
// @description  try to take over the world!
// @downloadURL  https://gist.github.com/TMVictor/3f24e27a21215414ddc68842057482da/raw/evolve_automation.user.js
// @author       Fafnir
// @author       TMVictor
// @match        https://pmotschmann.github.io/Evolve/
// @grant        none
// @require      https://code.jquery.com/jquery-3.3.1.min.js
// @require      https://code.jquery.com/ui/1.12.1/jquery-ui.min.js
// ==/UserScript==
//
// DIRECT LINK FOR GREASEMONKEY / TAMPERMONKEY: https://gist.github.com/TMVictor/3f24e27a21215414ddc68842057482da/raw/evolve_automation.user.js
// Just navigate to that link with one of the monkeys installed and it will load the script.
// You can update to latest through the relevent UI for each extension.
//
// Full release notes at: https://gist.github.com/TMVictor/e2a0634391002888469e79c13c62f60e
//
// * autoEvolution - Runs through the evolution part of the game through to founding a settlement. With no other modifiers it will target Antids.
//          See autoAchievements to target races that you don't have extinction achievements for yet. Settings available in Settings tab.
//  ** autoAchievements - Works through all evolution paths until all race's extinction achievements have been completed (also works with autoChallenge for starred achievements)
//  ** autoChallenge - Chooses ALL challenge options during evolution
// * autoFight - Sends troops to battle whenever Soldiers are full and there are no wounded. Adds to your offensive battalion and switches attach type when offensive
//          rating is greater than the rating cutoff for that attack type.
// * autoCraft - Craft when a specified crafting ratio is met. This changes throughout the game (lower in the beginning and rising as the game progresses)
// * autoBuild - Builds city and space building when it can an production allows (eg. Won't build a Fission Reactor if you don't have enough uranium production).
//          Currently has a few smarts for higher plasmid counts to get certain building built a little bit quicker. eg. If you don't have enough libraries / 
//          cottages / coal mines then it will stop building anything that uses the same materials for a while to allow you to craft the resources to build them.
//          Will only build the buildings that the user enables. Settings available in Settings tab.
// * autoMarket - Allows for automatic buying and selling of resources once specific ratios are met. Also allows setting up trade routes until a minimum
//          specified money per second is reached. The will trade in and out in an attempt to maximise your trade routes. Each resource can be configured
//          in the Market settings in the settings tab.
// * autoStorage - Assigns crates to allow storage of resources. Only assigns enough crates to reach MAD unless enabling autoSpace. Settings available in Settings tab.
// * autoResearch - Performs research when minimum requirements are met. Settings available in Settings tab.
// * autoARPA - Builds ARPA projects if user enables them to be built
// * autoJobs - Assigns jobs in a priority order with multiple breakpoints. Starts with a few jobs each and works up from there. Will try to put a minimum number on
//          lumber / stone then fill up capped jobs first. Settings available in Settings tab.
//  ** autoCraftsmen - Enable this when performing challenge runs and autoJobs will also manage craftsmen
// * autoTax - Adjusts tax rates if your current morale is greater than your maximum allowed morale. Will always keep morale above 100%.
// * autoPower - Manages power based on a priority order of buildings. Starts with city based building then space based. Settings available in Settings tab.
// * autoSmelter - Manages smelter output at different stages at the game. Not currently user configurable.
// * autoFactory - Manages factory production based on power and consumption. Produces alloys as a priority until nano-tubes then produces those as a priority.
//          Not currently user configurable.
// * autoMAD - Once MAD is unlocked will stop sending out troops and will perform MAD
// * autoSpace - Once MAD is unlocked it will start funding the launch facility regardless of arpa settings
// * autoSeeder - Will send out the seeder ship once at least 4 (or user entered max) probes are constructed. Currently tries to find a forest world, then grassland, then the others.
//          Not currently user configurable.
// * autoAssembleGene - Automatically assembles genes only when your knowledge is at max. Stops when DNA Sequencing is researched.
// 

//@ts-check
(function($) {
    'use strict';
    var settings = {};
    var jsonSettings = localStorage.getItem('settings');
    if (jsonSettings !== null) {
        settings = JSON.parse(jsonSettings);
    }

    var defaultAllOptionsEnabled = false;

    // --------------------

    //#region Class Declarations

    class Job {
        /**
         * @param {string} name
         * @param {string} tabPrefix
         * @param {any} concatenator
         * @param {string} id
         * @param {any} isCraftsman
         */
        constructor(name, tabPrefix, concatenator, id, isCraftsman) {
            this.name = name;
            this._tabPrefix = tabPrefix;
            this._concatenator = concatenator;
            this._id = id;
            this._originalName = name;
            this._originalId = id;
            this._elementId = this._tabPrefix + this._concatenator + this.id;
            this._isCraftsman = isCraftsman;

            this.autoJobEnabled = true; // Don't use defaultAllOptionsEnabled. By default assign all new jobs.
            this.priority = 0;

            /** @type {number[]} */
            this.breakpointMaxs = [];

            this.setupCache();
        }

        setupCache() {
            this.settingJobEnabled = "job_" + this.id;

            this._hashElementId = "#" + this._elementId;
            this._hashHtmlNameElement = "#" + this._elementId + " h3";
            this._hashCountElement = "#" + this._elementId + " .count";
            this._hashAddElement = "#" + this._elementId + " .add";
            this._hashSubElement = "#" + this._elementId + " .sub";
        }

        /**
         * @param {string} newName
         * @param {string} newId
         */
        updateId(newName, newId) {
            this.name = newName;
            this._id = newId;
            this._elementId = this._tabPrefix + this._concatenator + this.id;
            this.setupCache();
        }

        get id() {
            return this._id;
        }
        
        isUnlocked() {
            let containerNode = document.getElementById(this._elementId);
            return containerNode !== null && containerNode.style.display !== "none";
        }

        isManaged() {
            let isManaged = this.isUnlocked() && (this.id === "free" || settings[this.settingJobEnabled]);

            // Hunter races use "free" workers as their farmers. There aren't any settings associated with "free" workers so don't check whether they are enabled
            if (!this.isCraftsman()) {
                return isManaged;
            } else {
                // This is a hack for when we very first unlock crafting... Don't want to say they are managed before the UI updates with the resources
                if (this.id === state.jobs.Plywood.id) {
                    isManaged = isManaged && resources.plywood.isUnlocked();
                } else if (this.id === state.jobs.Brick.id) {
                    isManaged = isManaged && resources.brick.isUnlocked();
                }

                return isManaged;
            }
        }

        isCraftsman() {
            return this._isCraftsman;
        }

        getHtmlName() {
            let nameNode = document.querySelector(this._hashHtmlNameElement);

            if (nameNode === null) {
                return "";
            }

            return nameNode.textContent;
        }

        get current() {
            if (!this.isUnlocked()) {
                return 0;
            }

            let jobNode = document.querySelector(this._hashCountElement);
            if (jobNode !== null) {
                // 2 possibilities:
                // eg. "13 / 16" the current is 13
                // eg. "12" the current is 12
                let index = jobNode.textContent.indexOf("/");

                if (index === -1) {
                    return getRealNumber(jobNode.textContent);
                }

                return getRealNumber(jobNode.textContent.substring(0, index - 1));
            }

            return 0;
        }

        get max() {
            if (!this.isUnlocked()) {
                return 0;
            }

            let jobNode = document.querySelector(this._hashCountElement);
            if (jobNode !== null) {
                // 2 possibilities:
                // eg. "13 / 16" the current is 13
                // eg. "12" the current is 12
                let index = jobNode.textContent.indexOf("/");

                if (index === -1) {
                    return Number.MAX_SAFE_INTEGER;
                }

                return getRealNumber(jobNode.textContent.substring(index + 2));
            }

            return 0;
        }

        get available() {
            return this.max - this.current;
        }

        /**
         * @param {number} breakpoint
         * @param {number} employees
         */
        setBreakpoint(breakpoint, employees) {
            this.breakpointMaxs[breakpoint - 1] = employees;
        }

        /**
         * @param {number} breakpoint
         */
        getBreakpoint(breakpoint) {
            return this.breakpointMaxs[breakpoint - 1];
        }

        /**
         * @param {number} breakpoint
         */
        breakpointEmployees(breakpoint) {
            if ((breakpoint >= 0 && this.breakpointMaxs.length === 0) || breakpoint < 0 || breakpoint > this.breakpointMaxs.length - 1) {
                return 0;
            }

            let breakpointActual = this.breakpointMaxs[breakpoint];

            // -1 equals unlimited up to the maximum available jobs for this job
            if (breakpointActual === -1) {
                breakpointActual = Number.MAX_SAFE_INTEGER;
            }

            // return the actual workers required for this breakpoint (either our breakpoint or our max, whichever is lower)
            return Math.min(breakpointActual, this.max)
        }

        getAddButton() {
            return document.querySelector(this._hashAddElement);
        }

        getSubButton() {
            return document.querySelector(this._hashSubElement);
        }

        /**
         * @param {number} count
         */
        addWorkers(count) {
            if (!this.isUnlocked()) {
                return false;
            }

            if (count < 0) {
                this.removeWorkers(-1 * count);
            }

            if (this.current + count > this.max) {
                count = this.max - this.current;
            }

            let addButton = this.getAddButton();
            if (addButton !== null) {
                for (let i = 0; i < count; i++) {
                    // @ts-ignore
                    addButton.click();                
                }

                return true;
            }

            return false;
        }

        /**
         * @param {number} count
         */
        removeWorkers(count) {
            if (!this.isUnlocked()) {
                return false;
            }

            if (count < 0) {
                this.addWorkers(-1 * count);
            }

            if (this.current - count < 0) {
                count = this.current;
            }

            let subButton = this.getSubButton();
            if (subButton !== null) {
                for (let i = 0; i < count; i++) {
                    // @ts-ignore
                    subButton.click();                
                }

                return true;
            }

            return false;
        }

        addWorker() {
            if (!this.isUnlocked()) {
                return false;
            }

            // We already have all the workers of this type that we can
            if (this.current >= this.max) {
                return;
            }

            let addButton = this.getAddButton();
            if (addButton !== null) {
                // @ts-ignore
                addButton.click();
                return true;
            }

            return false;
        }

        removeWorker() {
            if (!this.isUnlocked()) {
                return false;
            }

            // Can't remove workers if we don't have any
            if (this.current <= 0) {
                return;
            }

            let subButton = this.getSubButton();
            if (subButton !== null) {
                // @ts-ignore
                subButton.click();
                return true;
            }

            return false;
        }
    }

    class CraftingJob extends Job {
        /**
         * @param {string} name
         * @param {string} tabPrefix
         * @param {any} concatenator
         * @param {string} id
         * @param {any} isCraftsman
         */
        constructor(name, tabPrefix, concatenator, id, isCraftsman) {
            super(name, tabPrefix, concatenator, id, isCraftsman);

            this._max = -1;

            this.resource = null;
        }

        getAddButton() {
            return document.querySelector(this._hashElementId).parentElement.querySelector(".add")
        }

        getSubButton() {
            return document.querySelector(this._hashElementId).parentElement.querySelector(".sub")
        }

        /**
         * @param {number} count
         */
        addWorkers(count) {
            if (!this.isUnlocked()) {
                return false;
            }

            if (count < 0) {
                this.removeWorkers(-1 * count);
            }

            let addButton = this.getAddButton();
            if (addButton !== null) {
                for (let i = 0; i < count; i++) {
                    // @ts-ignore
                    addButton.click();                
                }

                return true;
            }

            return false;
        }

        /**
         * @param {number} count
         */
        removeWorkers(count) {
            if (!this.isUnlocked()) {
                return false;
            }

            if (count < 0) {
                this.addWorkers(-1 * count);
            }

            let subButton = this.getSubButton();
            if (subButton !== null) {
                for (let i = 0; i < count; i++) {
                    // @ts-ignore
                    subButton.click();                
                }

                return true;
            }

            return false;
        }

        set max(employees) {
            this._max = employees;
        }

        get max() {
            if (!this.isUnlocked()) {
                return 0;
            }

            if (this._max === -1) {
                state.jobManager.calculateCraftingMaxs();
            }

            return this._max;
        }
    }

    class Action {
        /**
         * @param {string} name
         * @param {string} tabPrefix
         * @param {string} id
         * @param {boolean} isBuilding
         */
        constructor(name, tabPrefix, id, isBuilding) {
            this.name = name;
            this._tabPrefix = tabPrefix;
            this._id = id;
            this._elementId = this._tabPrefix + "-" + this.id;
            this._isBuilding = isBuilding;
            this.autoBuildEnabled = defaultAllOptionsEnabled;
            this.autoStateEnabled = true;

            if (this._id === "probes") { // Can't use buildings in the constructor as we are still creating them!
                this._autoMax = 4; // Max of 4 Probes by default
            } else {
                this._autoMax = -1;
            }

            this.priority = 0;

            this.consumption = {
                power: 0,

                /** @type {{ resource: Resource, initialRate: number, rate: number, }[]} */
                resourceTypes: [],
            };

            /** @type {ResourceRequirement[]} */
            this.resourceRequirements = [];

            this.setupCache();
        }

        setupCache() {
            this._hashElementId = '#' + this._elementId;
            this._hashButtonElement = this._hashElementId + ' .button';
            this._hashButtonCountElement = this._hashElementId + ' .button .count';
            this._hashWarnElement = this._hashElementId + ' .warn';
            this._hashOnElement = this._hashElementId + ' .on';
            this._hashOffElement = this._hashElementId + ' .off';
        }

        //#region Standard actions

        get id() {
            return this._id;
        }

        get autoMax() {
            // There are a couple of special buildings that are "clickable" but really aren't clickable. Lets check them here
            if (this.id == state.spaceBuildings.GasSpaceDock.id || this === state.spaceBuildings.DwarfWorldController) {
                // Only clickable once but then hangs around in a "clickable" state even though you can't get more than one...
                return this._autoMax === 0 ? 0 : 1;
            } else if (this === state.spaceBuildings.GasSpaceDockShipSegment) {
                // Only clickable 100 times but then hangs around in a "clickable" state even though you can't get more than 100...
                return this._autoMax >= 0 && this._autoMax <= 100 ? this._autoMax : 100;
            } else if (this === state.spaceBuildings.DwarfWorldCollider) {
                // Only clickable 1859 times but then hangs around in a "clickable" state even though you can't get more than 1859...
                return this._autoMax >= 0 && this._autoMax <= 1859 ? this._autoMax : 1859;
            }

            return this._autoMax < 0 ? Number.MAX_SAFE_INTEGER : this._autoMax;
        }

        set autoMax(value) {
            if (value < 0) value = -1;
            this._autoMax = value;
        }
        
        isUnlocked() {
            return document.getElementById(this._elementId) !== null;
        }

        isBuilding() {
            return this._isBuilding;
        }

        hasConsumption() {
            return this.consumption.power !== 0 || this.consumption.resourceTypes.length > 0;
        }

        updateResourceRequirements() {
            let actionNode = document.querySelector(this._hashButtonElement);

            if (actionNode === null || actionNode.attributes.length === 0) {
                return;
            }

            // Some building requirements can change but we want to reuse our resource requirements array if possible
            // (eg. shed requirements change over time)
            let count = 0;
            for (let i = 0; i < actionNode.attributes.length; i++) {
                const attribute = actionNode.attributes[i];

                if (attribute.nodeName.startsWith("data-")) {
                    if (this.resourceRequirements.length > count) {
                        this.resourceRequirements[i].resource = resources[attribute.nodeName.substring(5)];
                        this.resourceRequirements[i].quantity = getRealNumber(attribute.nodeValue);
                    } else {
                        this.resourceRequirements.push(new ResourceRequirement(resources[attribute.nodeName.substring(5)], getRealNumber(attribute.nodeValue)));
                    }
                    count++;
                }
            }

            // Remove any extra elements that we have that are greater than the current number of requirements
            while (this.resourceRequirements.length > count) {
                this.resourceRequirements.pop();
            }

            // let logText = this.id;
            // this.resourceRequirements.forEach(requirement => logText += " " + requirement.resource.id + " - " + requirement.quantity + ", ");
            // log("autoStorage", logText);
        }

        // Whether the container is clickable is determined by it's node class
        // - class="action" - the node is available for clicking
        // - class="action cna" - Not clickable right now (eg. you don't have enough resources)
        // - calss="action cnam" - not clickable as you don't meet the requirements (eg. you don't have enough storage)
        isClickable() {
            if (!this.isUnlocked()) {
                return false;
            }

            let containerNode = document.getElementById(this._elementId);
            
            // cna / cnam - can't afford / don't have enough storage to afford
            if (containerNode.className.indexOf("cna") !== -1) { return false; }

            // There are a couple of special buildings that are "clickable" but really aren't clickable. Lets check them here
            if (this.id === state.spaceBuildings.GasSpaceDock.id || this === state.spaceBuildings.DwarfWorldController) {
                // Only clickable once but then hangs around in a "clickable" state even though you can't get more than one...
                return this.count === 0;
            } else if (this === state.spaceBuildings.GasSpaceDockShipSegment) {
                // Only clickable 100 times but then hangs around in a "clickable" state even though you can't get more than 100...
                return this.count < 100;
            } else if (this === state.spaceBuildings.DwarfWorldCollider) {
                // Only clickable 1859 times but then hangs around in a "clickable" state even though you can't get more than 1859...
                return this.count < 1859;
            }
            
            return true;
        }
        
        // This is a "safe" click. It will only click if the container is currently clickable.
        // ie. it won't bypass the interface and click the node if it isn't clickable in the UI.
        click() {
            if (!this.isClickable()) {
                return false
            }
            
            let containerNode = document.getElementById(this._elementId);
            let mainClickNode = containerNode.getElementsByTagName("a")[0];
            
            // Click it real good
            if (mainClickNode !== null) {
                mainClickNode.click();
                return true;
            }
            
            return false;
        }

        /**
         * @param {number} rate
         */
        addPowerConsumption(rate) {
            this.consumption.power = rate;
        }

        /**
         * @param {Resource} resource
         * @param {number} rate
         */
        addResourceConsumption(resource, rate) {
            this.consumption.resourceTypes.push({ resource: resource, initialRate: rate, rate: rate });
        }

        //#endregion Standard actions

        //#region Buildings

        hasCount() {
            if (!this.isUnlocked()) {
                return false;
            }

            return document.querySelector(this._hashButtonCountElement) !== null;
        }
        
        get count() {
            if (!this.hasCount()) {
                return 0;
            }

            return parseInt(document.querySelector(this._hashButtonCountElement).textContent);
        }
        
        hasState() {
            if (!this.isUnlocked()) {
                return false;
            }

            // If there is an "on" state count node then there is state
            return document.querySelector(this._hashOnElement) !== null;
        }
        
        get stateOnCount() {
            if (!this.hasState()) {
                return 0;
            }
            
            return parseInt(document.querySelector(this._hashOnElement).textContent);
        }
        
        get stateOffCount() {
            if (!this.hasState()) {
                return 0;
            }
            
            return parseInt(document.querySelector(this._hashOffElement).textContent);
        }

        isStateOnWarning() {
            if (!this.hasState()) {
                return false;
            }

            if (this.stateOnCount === 0) {
                return false;
            }
            
            return document.querySelector(this._hashWarnElement) !== null;
        }
        
        // Make the click a little more meaningful for a building
        tryBuild() {
            return this.click();
        }

        /**
         * @param {number} adjustCount
         */
        tryAdjustState(adjustCount) {
            if (!this.hasState() || adjustCount === 0) {
                return false;
            }

            let containerNode = document.getElementById(this._elementId);
            
            if (adjustCount > 0) {
                let onNode = containerNode.querySelector(' .on');

                for (let i = 0; i < adjustCount; i++) {
                    // @ts-ignore
                    onNode.click();
                }

                return;
            }

            if (adjustCount < 0) {
                let offNode = containerNode.querySelector(' .off');
                adjustCount = adjustCount * -1;

                for (let i = 0; i < adjustCount; i++) {
                    // @ts-ignore
                    offNode.click();
                }

                return;
            }
        }
        
        trySetStateOn() {
            if (!this.hasState()) {
                return false;
            }
            
            // @ts-ignore
            document.querySelector(this._hashOnElement).click();
        }
        
        trySetStateOff() {
            if (!this.hasState()) {
                return false;
            }
            
            // @ts-ignore
            containerNode.querySelector(this._hashOffElement).click();
        }

        //#endregion Buildings
    }

    class ResourceProductionCost {
        /**
         * @param {Resource} resource
         * @param {number} quantity
         * @param {number} minRateOfChange
         */
        constructor(resource, quantity, minRateOfChange) {
            this.resource = resource;
            this.quantity = quantity;
            this.minRateOfChange = minRateOfChange;
        }
    }

    class ResourceRequirement {
        /**
         * @param {Resource} resource
         * @param {number} quantity
         */
        constructor(resource, quantity) {
            this.resource = resource;
            this.quantity = quantity;
        }
    }

    class Resource {
        /**
         * @param {string} name
         * @param {string} prefix
         * @param {string} id
         * @param {boolean} hasStorage
         * @param {boolean} isTradable
         * @param {number} tradeRouteQuantity
         * @param {boolean} isCraftable
         * @param {number} craftRatio
         * @param {boolean} isSupport
         */
        constructor(name, prefix, id, hasStorage, isTradable, tradeRouteQuantity, isCraftable, craftRatio, isSupport) {
            this._prefix = prefix;
            this.name = name;
            this._id = id;
            this._isPopulation = (id === "Population"); // We can't store the full elementId because we don't know the name of the population node until later
            this.autoCraftEnabled = defaultAllOptionsEnabled;

            this._isTradable = isTradable;
            this.tradeRouteQuantity = tradeRouteQuantity;
            this.currentTradeRouteBuyPrice = 0;
            this.currentTradeRouteSellPrice = 0;
            this.currentTradeRoutes = 0;

            this.marketPriority = 0;
            this.autoBuyEnabled = false;
            this.autoSellEnabled = false;
            this.autoBuyRatio = -1;
            this.autoSellRatio = -1;
            this.autoTradeBuyEnabled = false;
            this.autoTradeBuyRoutes = 0;
            this.autoTradeSellEnabled = true;
            this.autoTradeSellMinPerSecond = 0;

            this.isAssignedCratesUpdated = false;
            this.assignedCrates = 0;
            this.isAssignedContainersUpdated = false;
            this.assignedContainers = 0;
            this.lastConstructStorageAttemptLoopCounter = 0;

            this.hasStorage = hasStorage;
            this.storagePriority = 0;
            this.autoStorageEnabled = true;
            this.autoStorageWeighting = 0;
            this._autoCratesMax = -1;
            this._autoContainersMax = -1;

            this._isCraftable = isCraftable;
            this.craftRatio = craftRatio;

            this.isSupport = isSupport;

            this.calculatedRateOfChange = 0;

            /** @type {ResourceRequirement[]} */
            this.resourceRequirements = [];

            /** @type {ResourceProductionCost[]} */
            this.productionCost = [];
        }

        //#region Standard resource

        get id() {
            // The population node is special and its id is actually the race name rather than a static name
            if (!this._isPopulation) {
                return this._id;
            }

            return getRaceId();
        }
        
        isUnlocked() {
            let containerNode = document.getElementById(this._prefix + this.id);
            return containerNode !== null && containerNode.style.display !== "none";
        }

        isManagedStorage() {
            return this.autoStorageEnabled && this.isUnlocked() && this.hasOptions();
        }

        /**
         * @param {boolean} buy
         * @param {number} buyRatio
         * @param {boolean} sell
         * @param {number} sellRatio
         * @param {boolean} tradeBuy
         * @param {number} tradeBuyRoutes
         * @param {boolean} tradeSell
         * @param {number} tradeSellMinPerSecond
         */
        updateMarketState(buy, buyRatio, sell, sellRatio, tradeBuy, tradeBuyRoutes, tradeSell, tradeSellMinPerSecond) {
            this.autoBuyEnabled = buy;
            this.autoBuyRatio = buyRatio;
            this.autoSellEnabled = sell;
            this.autoSellRatio = sellRatio;
            this.autoTradeBuyEnabled = tradeBuy;
            this.autoTradeBuyRoutes = tradeBuyRoutes;
            this.autoTradeSellEnabled = tradeSell;
            this.autoTradeSellMinPerSecond = tradeSellMinPerSecond;
        }

        /**
         * @param {boolean} enabled
         * @param {number} weighting
         * @param {number} maxCrates
         * @param {number} maxContainers
         */
        updateStorageState(enabled, weighting, maxCrates, maxContainers) {
            this.autoStorageEnabled = enabled;
            this.autoStorageWeighting = weighting;
            this._autoCratesMax = maxCrates;
            this._autoContainersMax = maxContainers;
        }

        hasOptions() {
            // Options is currently the + button for accessing crates and containers
            if (!this.isUnlocked()) {
                return false;
            }

            return document.getElementById("con" + this.id) !== null;
        }

        get isTradable() {
            return this._isTradable;
        }

        get isCraftable() {
            return this._isCraftable;
        }

        get currentQuantity() {
            if (!this.isUnlocked()) {
                return 0;
            }

            let storageNode = document.getElementById("cnt" + this.id);

            if (storageNode !== null) {
                // 2 possibilities:
                // eg. "3124.16" the current quantity is 3124.16
                // eg. in "1234 / 10.2K" the current quantity is 1234
                if (storageNode.textContent.indexOf("/") === -1) {
                    return getRealNumber(storageNode.textContent);
                }

                return getRealNumber(storageNode.textContent.split(" / ")[0]);
            }

            // If storage node is null then it might be plasmids which doesn't have the id...
            let countNode = document.querySelector("#" + this._prefix + this.id + " .count");
            if (countNode !== null) {
                return parseInt(countNode.textContent);
            }

            // No idea!
            return 0;
        }

        get maxQuantity() {
            if (!this.isUnlocked()) {
                return 0;
            }

            let storageNode = document.getElementById("cnt" + this.id);

            // 2 possibilities:
            // eg. "3124.16" there is no max quantity
            // eg. in "1234 / 10.2K" the current quantity is 1234
            if (storageNode === null || storageNode.textContent.indexOf("/") === -1) {
                return Number.MAX_SAFE_INTEGER;
            }

            // eg. in "1234 / 10.2K" the max quantity is 10.2K
            return getRealNumber(storageNode.textContent.split(" / ")[1]);
        }
        
        get storageRatio() {
            // If "326 / 1204" then storage ratio would be 0.27 (ie. storage is 27% full)
            let max = this.maxQuantity;

            if (this.maxQuantity === 0) {
                return 0;
            }

            return this.currentQuantity / max;
        }

        get rateOfChange() {
            if (!this.isUnlocked()) {
                return 0;
            }

            let rateOfChangeNode = document.getElementById("inc" + this.id);

            // There is no rate of change for this resource
            if (rateOfChangeNode === null) {
                return 0;
            }

            // eg. "11.6K /s" the rate of change is 11600
            return getRealNumber(rateOfChangeNode.textContent.split(' /s')[0]);
        }

        //#endregion Standard resource

        //#region Basic resource

        get autoCratesMax() {
            return this._autoCratesMax < 0 ? 1000000 : this._autoCratesMax;
        }

        /**
         * @param {number} value
         */
        set autoCratesMax(value) {
            this._autoCratesMax = value;
        }

        get autoContainersMax() {
            return this._autoContainersMax < 0 ? 1000000 : this._autoContainersMax;
        }

        /**
         * @param {number} value
         */
        set autoContainersMax(value) {
            this._autoContainersMax = value;
        }

        isOptionsOpen() {
            if (!this.hasOptions()) {
                return;
            }

            return (state.windowManager.isOpen() && state.windowManager.currentModalWindowTitle === this.name);
        }
        
        openOptions() {
            if (!this.hasOptions()) {
                return;
            }
            
            let optionsNode = document.getElementById("con" + this.id);
            state.windowManager.openModalWindow();
            optionsNode.click();
        }

        updateCachedOptions() {
            // We can only update options when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            // eg. "Crates Assigned: 100"
            let assignedCratesNode = document.querySelector('#modalCrates .crateHead > span:nth-child(2)');
            this.isAssignedCratesUpdated = true;
            if (assignedCratesNode !== null) {
                this.assignedCrates = parseInt(assignedCratesNode.textContent.substring(17));
            } else {
                this.assignedCrates = 0;
            }

            // eg. "Containers Assigned: 0"
            let assignedContainersNode = document.querySelector('#modalContainers .crateHead > span:nth-child(2)');
            this.isAssignedContainersUpdated = true;
            if (assignedContainersNode !== null) {
                this.assignedContainers = parseInt(assignedContainersNode.textContent.substring(21));
            } else {
                this.assignedContainers = 0;
            }

            return true;
        }

        tryConstructCrate() {
            // We can only construct a crate when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            let crateButtons = document.querySelectorAll('#modalCrates .button');
            for (let i = 0; i < crateButtons.length; i++) {
                if (crateButtons[i].textContent === "Construct Crate") {
                    // @ts-ignore
                    crateButtons[i].click();
                    return true;
                }
            }

            return false;
        }

        tryAssignCrate() {
            // We can only assign a crate when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            let crateButtons = document.querySelectorAll('#modalCrates .button');
            for (let i = 0; i < crateButtons.length; i++) {
                if (crateButtons[i].textContent === "Assign Crate") {
                    // @ts-ignore
                    crateButtons[i].click();
                    return true;
                }
            }

            return false;
        }

        tryUnassignCrate() {
            // We can only unassign a crate when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            let crateButtons = document.querySelectorAll('#modalCrates .button');
            for (let i = 0; i < crateButtons.length; i++) {
                if (crateButtons[i].textContent === "Unassign Crate") {
                    // @ts-ignore
                    crateButtons[i].click();
                    return true;
                }
            }

            return false;
        }

        tryConstructContainer() {
            // We can only construct a container when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            let containerButtons = document.querySelectorAll('#modalContainers .button');
            for (let i = 0; i < containerButtons.length; i++) {
                if (containerButtons[i].textContent === "Construct Container") {
                    // @ts-ignore
                    containerButtons[i].click();
                    return true;
                }
            }

            return false;
        }

        tryAssignContainer() {
            // We can only assign a container when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            let containerButtons = document.querySelectorAll('#modalContainers .button');
            for (let i = 0; i < containerButtons.length; i++) {
                if (containerButtons[i].textContent === "Assign Container") {
                    // @ts-ignore
                    containerButtons[i].click();
                    return true;
                }
            }

            return false;
        }

        tryUnassignContainer() {
            // We can only unassign a container when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            let containerButtons = document.querySelectorAll('#modalContainers .button');
            for (let i = 0; i < containerButtons.length; i++) {
                if (containerButtons[i].textContent === "Unassign Container") {
                    // @ts-ignore
                    containerButtons[i].click();
                    return true;
                }
            }

            return false;
        }

        //#endregion Basic resource

        //#region Craftable resource

        isCraftingUnlocked() {
            if (!this.isUnlocked()) {
                return false
            }

            return document.getElementById("inc" + this.id + "A") !== null;
        }

        /**
         * @param {string} toCraft
         */
        tryCraftX(toCraft) {
            if (!this.isUnlocked()) {
                return false
            }

            // Get the required clickable craft node and if we find it, clilck it
            let craftClickNode = document.getElementById("inc" + this.id + toCraft);

            if (craftClickNode === null) {
                return false;
            }
            
            craftClickNode = craftClickNode.getElementsByTagName("a")[0];

            if (craftClickNode !== null) {
                craftClickNode.click();
                return true;
            }
            
            return false;
        }

        //#endregion Craftable resource
    }

    class Power extends Resource {
        // This isn't really a resource but we're going to make a dummy one so that we can treat it like a resource
        constructor() {
            super("Power", "", "powerMeter", false, false, -1, false, -1, false);
        }

        //#region Standard resource

        get id() {
            return this._id;
        }

        hasOptions() {
            return false;
        }

        get currentQuantity() {
            if (!this.isUnlocked()) {
                return 0;
            }

            return parseInt(document.getElementById("powerMeter").textContent);
        }

        get maxQuantity() {
            return Number.MAX_SAFE_INTEGER;
        }
        
        get storageRatio() {
            return this.currentQuantity / this.maxQuantity;
        }

        get rateOfChange() {
            // This isn't really a resource so we'll be super tricky here and set the rate of change to be the available quantity
            return this.currentQuantity;
        }

        //#endregion Standard resource

        //#region Basic resource

        isOptionsOpen() {
            return false;
        }
        
        openOptions() {
            return;
        }

        updateCachedOptions() {
            return false;
        }

        tryConstructCrate() {
            return false;
        }

        tryAssignCrate() {
            return false;
        }

        tryUnassignCrate() {
            return false;
        }

        tryConstructContainer() {
            return false;
        }

        tryAssignContainer() {
            return false;
        }

        tryUnassignContainer() {
            return false;
        }

        //#endregion Basic resource

        //#region Craftable resource

        /**
         * @param {string} toCraft
         */
        tryCraftX(toCraft) {
            return false;
        }

        //#endregion Craftable resource
    }

    class Support extends Resource {
        // This isn't really a resource but we're going to make a dummy one so that we can treat it like a resource
        
        /**
         * @param {string} name
         * @param {string} id
         */
        constructor(name, id) {
            super(name, "", id, false, false, -1, false, -1, true);
        }

        //#region Standard resource

        get id() {
            return this._id;
        }

        hasOptions() {
            return false;
        }

        get currentQuantity() {
            if (!this.isUnlocked()) {
                return 0;
            }

            // "43/47"
            return parseInt(document.querySelector("#" + this.id + " > span:nth-child(2)").textContent.split("/")[0]);
        }

        get maxQuantity() {
            if (!this.isUnlocked()) {
                return 0;
            }

            // "43/47"
            return parseInt(document.querySelector("#" + this.id + " > span:nth-child(2)").textContent.split("/")[1]);
        }

        get rateOfChange() {
            // This isn't really a resource so we'll be super tricky here and set the rate of change to be the available quantity
            return this.maxQuantity - this.currentQuantity;
        }

        //#endregion Standard resource

        //#region Basic resource

        isOptionsOpen() {
            return false;
        }
        
        openOptions() {
            return;
        }

        updateCachedOptions() {
            return false;
        }

        tryConstructCrate() {
            return false;
        }

        tryAssignCrate() {
            return false;
        }

        tryUnassignCrate() {
            return false;
        }

        tryConstructContainer() {
            return false;
        }

        tryAssignContainer() {
            return false;
        }

        tryUnassignContainer() {
            return false;
        }

        //#endregion Basic resource

        //#region Craftable resource

        /**
         * @param {string} toCraft
         */
        tryCraftX(toCraft) {
            return false;
        }

        //#endregion Craftable resource
    }

    class LuxuryGoods extends Resource {
        // This isn't really a resource but we're going to make a dummy one so that we can treat it like a resource
        constructor() {
            super("Luxury Goods", "", "LuxuryGoods", false, false, -1, false, -1, false);
        }

        //#region Standard resource

        get id() {
            return this._id;
        }

        isUnlocked() {
            return true;
        }

        hasOptions() {
            return false;
        }

        get currentQuantity() {
            if (!this.isUnlocked()) {
                return 0;
            }

            // "43/47"
            return 0;
        }

        get maxQuantity() {
            if (!this.isUnlocked()) {
                return 0;
            }

            // "43/47"
            return Number.MAX_SAFE_INTEGER;
        }

        get rateOfChange() {
            // This isn't really a resource so we'll be super tricky here and set the rate of change to be the available quantity
            return 0;
        }

        //#endregion Standard resource

        //#region Basic resource

        isOptionsOpen() {
            return false;
        }
        
        openOptions() {
            return;
        }

        updateCachedOptions() {
            return false;
        }

        tryConstructCrate() {
            return false;
        }

        tryAssignCrate() {
            return false;
        }

        tryUnassignCrate() {
            return false;
        }

        tryConstructContainer() {
            return false;
        }

        tryAssignContainer() {
            return false;
        }

        tryUnassignContainer() {
            return false;
        }

        //#endregion Basic resource

        //#region Craftable resource

        /**
         * @param {string} toCraft
         */
        tryCraftX(toCraft) {
            return false;
        }

        //#endregion Craftable resource
    }

    const SmelterFuelTypes = {
        Lumber: 0,
        Coal: 1,
        Oil: 2,
    }

    const SmelterSmeltingTypes = {
        Iron: 0,
        Steel: 1,
    }

    class Smelter extends Action {
        constructor() {
            super("Smelter", "city", "smelter", true);

            this.isUpdated = false;

            this.toalFueledCount = 0;
            this.totalFueledMax = 0;

            /** @type {boolean[]} */
            this._isFuelUnlocked = [ false, false, false ];

            /** @type {number[]} */
            this._fueled = [ 0, 0, 0 ];

            /** @type {boolean[]} */
            this._isSmeltingUnlocked = [ false, false ];

            /** @type {number[]} */
            this._smelting = [ 0, 0 ];

            /** @type {ResourceProductionCost[][]} */
            this.smeltingConsumption = [ [], [] ];
        }

        /**
         * @param {number} smeltingType
         * @param {Resource} resource
         * @param {number} quantity
         * @param {number} minRateOfChange
         */
        addSmeltingConsumption(smeltingType, resource, quantity, minRateOfChange) {
            this.smeltingConsumption[smeltingType].push(new ResourceProductionCost(resource, quantity, minRateOfChange));
        }

        hasOptions() {
            // Options is currently the cog button for accessing settings
            if (!this.isUnlocked()) {
                return false;
            }

            return document.querySelector("#city-smelter .special") !== null;
        }

        isOptionsOpen() {
            if (!this.hasOptions()) {
                return;
            }

            return state.windowManager.isOpen() && state.windowManager.currentModalWindowTitle === "Smelter";
        }
        
        /**
         * @param {Function} callbackFunction
         * @param {any} callbackFunctionParameter
         */
        openOptions(callbackFunction, callbackFunctionParameter) {
            if (!this.hasOptions() || state.windowManager.isOpen()) {
                return;
            }
            
            let optionsNode = document.querySelector("#city-smelter .special");
            state.windowManager.openModalWindowWithCallback("Smelter", callbackFunction, callbackFunctionParameter);
            // @ts-ignore
            optionsNode.click();
        }

        updateCachedOptions() {
            // We can only update options when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            let fueledTitleNode = document.querySelector("#specialModal .has-text-info");
            if (fueledTitleNode !== null) {
                this.toalFueledCount = parseInt(fueledTitleNode.textContent.split("/")[0]);
                this.totalFueledMax = parseInt(fueledTitleNode.textContent.split("/")[1]);
            }

            let fueledCurrentNodes = document.querySelectorAll("#specialModal .current");
            for (let i = 0; i < fueledCurrentNodes.length; i++) {
                this._isFuelUnlocked[i] = true;
                this._fueled[i] = parseInt(fueledCurrentNodes[i].textContent.substring(fueledCurrentNodes[i].textContent.indexOf(" ") + 1))
            }

            let smeltingCurrentNodes = document.querySelectorAll("#specialModal .smelting .button");
            for (let i = 0; i < smeltingCurrentNodes.length; i++) {
                this._isSmeltingUnlocked[i] = true;
                this._smelting[i] = parseInt(smeltingCurrentNodes[i].textContent.substring(smeltingCurrentNodes[i].textContent.indexOf(": ") + 2))
            }

            this.isUpdated = true;
            
            return true;
        }

        /**
         * @param {number} fuelType
         */
        isFuelUnlocked(fuelType) {
            return this._isFuelUnlocked[fuelType];
        }

        /**
         * @param {number} fuelType
         */
        fueledCount(fuelType) {
            return this._fueled[fuelType];
        }

        /**
         * @param {number} smeltingType
         */
        smeltingCount(smeltingType) {
            return this._smelting[smeltingType];
        }

        /**
         * @param {number} smeltingType
         */
        isSmeltingUnlocked(smeltingType) {
            // Iron is always unlocked if the smelter is available
            if (smeltingType === SmelterSmeltingTypes.Iron) {
                return this.isUnlocked();
            }

            if (smeltingType === SmelterSmeltingTypes.Steel) {
                return document.querySelector("#tech-steel .oldTech") !== null;
            }

            return false;
        }

        /**
         * @param {number} fuelType
         * @param {number} quantity
         */
        increaseFuel(fuelType, quantity) {
            if (quantity < 0) {
                return this.decreaseFuel(fuelType, quantity * -1);
            }

            if (quantity === 0 || !this.isOptionsOpen()) {
                return false;
            }

            let fuelAddNodes = document.querySelectorAll("#specialModal .add");
            if (fuelAddNodes.length > fuelType) {
                let node = fuelAddNodes[fuelType];
                for (let i = 0; i < quantity; i++) {
                    //@ts-ignore
                    node.click();

                    this.fueledCount[fuelType]++;
                }
                return true;
            }

            // The type of fuel isn't unlocked yet
            return false;
        }

        /**
         * @param {number} fuelType
         * @param {number} quantity
         */
        decreaseFuel(fuelType, quantity) {
            if (quantity < 0) {
                return this.increaseFuel(fuelType, quantity * -1);
            }

            if (quantity === 0 || !this.isOptionsOpen()) {
                return false;
            }

            let fuelSubNodes = document.querySelectorAll("#specialModal .sub");
            if (fuelSubNodes.length > fuelType) {
                let node = fuelSubNodes[fuelType];
                for (let i = 0; i < quantity; i++) {
                    //@ts-ignore
                    node.click();

                    this.fueledCount[fuelType]--;
                }
                return true;
            }

            // The type of fuel isn't unlocked yet
            return false;
        }

        /**
         * @param {number} smeltingType
         * @param {number} quantity
         */
        increaseSmelting(smeltingType, quantity) {
            // Increasing one decreases the other so no need for both an "increaseXXXX" and a "descreaseXXXX"
            if (quantity === 0 || !this.isOptionsOpen()) {
                return false;
            }

            let smeltingNodes = document.querySelectorAll("#specialModal .smelting .button");
            if (smeltingNodes.length > smeltingType) {
                let node = smeltingNodes[smeltingType];
                for (let i = 0; i < quantity; i++) {
                    //@ts-ignore
                    node.click();

                    this._smelting[smeltingType]++;

                    if (smeltingType === SmelterSmeltingTypes.Steel) {
                        this._smelting[SmelterSmeltingTypes.Iron]--;
                    } else if (smeltingType === SmelterSmeltingTypes.Iron) {
                        this._smelting[SmelterSmeltingTypes.Steel]--;
                    }
                }
                return true;
            }

            // The type of smelting isn't unlocked yet
            return false;
        }
    }

    const FactoryGoods = {
        LuxuryGoods: 0,
        Alloy: 1,
        Polymer: 2,
        NanoTube: 3,
    }

    class Factory extends Action {
        constructor() {
            super("Factory", "city", "factory", true);

            this.isUpdated = false;
            this.currentOperating = 0;
            this.maxOperating = 0;

            /** @type {boolean[]} */
            this._isProductionUnlocked = [ false, false, false, false ];

            /** @type {number[]} */
            this._currentProduction = [ 0, 0, 0, 0 ];
        }

        /**
         * @param {number} factoryGoods
         */
        isProductionUnlocked(factoryGoods) {
            return this._isProductionUnlocked[factoryGoods];
        }

        /**
         * @param {number} factoryGoods
         */
        currentProduction(factoryGoods) {
            return this._currentProduction[factoryGoods];
        }

        hasOptions() {
            // Options is currently the cog button for accessing settings
            if (!this.isUnlocked()) {
                return false;
            }

            return document.querySelector("#city-factory .special") !== null;
        }

        isOptionsOpen() {
            if (!this.hasOptions()) {
                return;
            }

            return state.windowManager.isOpen() && state.windowManager.currentModalWindowTitle === "Factory";
        }
        
        /**
         * @param {Function} callbackFunction
         * @param {any} callbackFunctionParameter
         */
        openOptions(callbackFunction, callbackFunctionParameter) {
            if (!this.hasOptions() || state.windowManager.isOpen()) {
                return;
            }
            
            let optionsNode = document.querySelector("#city-factory .special");
            state.windowManager.openModalWindowWithCallback("Factory", callbackFunction, callbackFunctionParameter);
            // @ts-ignore
            optionsNode.click();
        }

        updateCachedOptions() {
            // We can only update options when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            let operatingNode = document.querySelector("#specialModal > div > span:nth-child(2)");
            if (operatingNode !== null) {
                this.currentOperating = parseInt(operatingNode.textContent.split("/")[0]);
                this.maxOperating = parseInt(operatingNode.textContent.split("/")[1]);
            }

            let productionNodes = document.querySelectorAll("#specialModal .factory");
            this._isProductionUnlocked[FactoryGoods.LuxuryGoods] = productionNodes.length > FactoryGoods.LuxuryGoods;
            this._isProductionUnlocked[FactoryGoods.Alloy] = productionNodes.length > FactoryGoods.Alloy;
            this._isProductionUnlocked[FactoryGoods.Polymer] = productionNodes.length > FactoryGoods.Polymer;
            this._isProductionUnlocked[FactoryGoods.NanoTube] = productionNodes.length > FactoryGoods.NanoTube;

            for (let i = 0; i < this._currentProduction.length; i++) {
                if (this._isProductionUnlocked[i]) {
                    this._currentProduction[i] = parseInt(productionNodes[i].querySelector(".current").textContent);
                }
            }

            this.isUpdated = true;
            return true;
        }

        /**
         * @param {number} factoryGoods
         * @param {number} quantity
         */
        increaseProduction(factoryGoods, quantity) {
            if (quantity < 0) {
                return this.decreaseProduction(factoryGoods, quantity * -1);
            }

            if (quantity === 0 || !this.isOptionsOpen()) {
                return false;
            }

            let productionNodes = document.querySelectorAll("#specialModal .factory");
            if (productionNodes.length > factoryGoods) {
                let node = productionNodes[factoryGoods].querySelector(".add");
                for (let i = 0; i < quantity; i++) {
                    //@ts-ignore
                    node.click();

                    this._currentProduction[factoryGoods]++;
                }
                return true;
            }

            // The type of factory goods aren't unlocked yet
            return false;
        }

        /**
         * @param {number} factoryGoods
         * @param {number} quantity
         */
        decreaseProduction(factoryGoods, quantity) {
            if (quantity < 0) {
                return this.increaseProduction(factoryGoods, quantity * -1);
            }

            if (quantity === 0 || !this.isOptionsOpen()) {
                return false;
            }

            let productionNodes = document.querySelectorAll("#specialModal .factory");
            if (productionNodes.length > factoryGoods) {
                let node = productionNodes[factoryGoods].querySelector(".sub");
                for (let i = 0; i < quantity; i++) {
                    //@ts-ignore
                    node.click();

                    this._currentProduction[factoryGoods]--;
                }
                return true;
            }

            // The type of factory goods aren't unlocked yet
            return false;
        }
    }

    class SpaceDock extends Action {
        constructor() {
            super("Gas Space Dock", "space", "star_dock", true);

            this.Probes = null;
            this.Ship = null;
            this.Launch = new Action("Gas Launch Ship", "spcdock", "launch_ship", true);

            this._isOptionsUpdated = false;

            this._isProbesUnlocked = false;
            this.lastProbeCount = 0;

            this._isShipUnlocked = false;
            this.lastShipSegmentCount = 0;
        }

        isProbesUnlocked() {
            return this._isProbesUnlocked;
        }

        isShipUnlocked() {
            return this._isShipUnlocked;
        }

        hasOptions() {
            // Options is currently the cog button for accessing settings
            if (!this.isUnlocked()) {
                return false;
            }

            return document.querySelector("#space-star_dock .special") !== null;
        }

        isOptionsUpdated() {
            return this._isOptionsUpdated;
        }

        isOptionsOpen() {
            if (!this.hasOptions()) {
                return;
            }

            return state.windowManager.isOpen() && state.windowManager.currentModalWindowTitle === "Space Dock";
        }
        
        openOptions() {
            if (!this.hasOptions()) {
                return;
            }
            
            let optionsNode = document.querySelector("#space-star_dock .special");
            state.windowManager.openModalWindow();
            // @ts-ignore
            optionsNode.click();
        }

        updateOptions() {
            // We can only update options when the options window is open
            if (!this.isOptionsOpen()) {
                return false;
            }

            this._isOptionsUpdated = true;

            this._isProbesUnlocked = this.Probes.isUnlocked();
            this.lastProbeCount = this.Probes.count;

            this._isShipUnlocked = this.Ship.isUnlocked();
            this.lastShipSegmentCount = this.Ship.count;
        }

        tryBuildProbe() {
            if (!this.isOptionsOpen()) {
                return false;
            }

            return this.Probes.tryBuild();
        }

        tryBuildShipSegment() {
            // There are only 100 segments
            if (this.lastShipSegmentCount >= 100) {
                return false;
            }

            if (!this.isOptionsOpen()) {
                return false;
            }

            if (this.Ship.count >= 100) {
                return false;
            }

            // We're just going to try clicking 5 times until we get to 100 segments
            let canClick = this.Ship.tryBuild();
            if (canClick) {
                this.Ship.tryBuild()
                this.Ship.tryBuild()
                this.Ship.tryBuild()
                this.Ship.tryBuild()
            }

            return canClick;
        }

        tryLaunchShip() {
            if (!this.isOptionsOpen()) {
                return false;
            }

            return this.Launch.click();
        }
    }

    class ModalWindowManager {
        constructor() {
            this.openedByScript = false;

            this._callbackWindowTitle = "";
            this._callbackFunction = null;
            this._callbackFunctionParameter = null;

            /** @type {{ windowName: string, optionsObject: any }[]} */
            this._callbacks = [];

            /** @type {Resource[]} */
            this._resourcesToRefreshOptions = [];
            /** @type {{ cratesToBuild: number; containersToBuild: number; availableCrates: number, availableContainers: number, adjustments: any[]; }} */
            this._storageChanges = null;
            /** @type {Resource} */
            this._openingResourceWindow = null;
        }

        /**
         * @param {string} windowName
         * @param {{ updateCachedOptions: () => void; }} optionsObject
         */
        addGeneralCallback(windowName, optionsObject) {
            this._callbacks.push({windowName: windowName, optionsObject: optionsObject});
        }

        /**
         * @param {string} oldWindowName
         * @param {string} windowName
         */
        updateGeneralCallback(oldWindowName, windowName) {
            let index = findArrayIndex(this._callbacks, "windowName", oldWindowName);

            if (index !== -1) {
                console.log("updating " + oldWindowName + " to be " + windowName)
                this._callbacks[index].windowName = windowName;
            }
        }

        /**
         * @param {Resource[]} resources
         */
        updateResourceCachedOptions(resources) {
            if (this.isOpen()) {
                return;
            }

            if (resources.length === 0) {
                return;
            }

            this._resourcesToRefreshOptions = resources;
            this._openingResourceWindow = this._resourcesToRefreshOptions[0];
            this._openingResourceWindow.openOptions();
        }

        /**
         * @param {{ cratesToBuild: number; containersToBuild: number; availableCrates: number, availableContainers: number, adjustments: any[]; }} storageChanges
         */
        updateStorage(storageChanges) {
            if (this.isOpen()) {
                return;
            }

            if (storageChanges.cratesToBuild === 0 && storageChanges.containersToBuild === 0 && storageChanges.adjustments.length === 0) {
                return;
            }

            this._storageChanges = storageChanges;

            // If we are just building storage then this may not be set...
            if (this._storageChanges.adjustments.length > 0) {
                this._openingResourceWindow = this._storageChanges.adjustments[0].resource;
            } else {
                this._openingResourceWindow = state.storageManager.managedPriorityList()[0];
            }

            this._openingResourceWindow.openOptions();
        }

        get currentModalWindowTitle() {
            let modalTitleNode = document.getElementById("modalBoxTitle");
            if (modalTitleNode === null) {
                return "";
            }

            // Modal title will either be a single name or a combination of resource and storage 
            // eg. single name "Smelter" or "Factory"
            // eg. combination "Iridium - 26.4K/279.9K"
            let indexOfDash = modalTitleNode.textContent.indexOf(" - ");
            if (indexOfDash === -1) {
                return modalTitleNode.textContent;
            } else {
                return modalTitleNode.textContent.substring(0, indexOfDash);
            }
        }

        openModalWindow() {
            this.openedByScript = true;
        }

        /**
         * @param {string} callbackWindowTitle
         * @param {Function} callbackFunction
         * @param {any} callbackFunctionParameter
         */
        openModalWindowWithCallback(callbackWindowTitle, callbackFunction, callbackFunctionParameter) {
            if (this.isOpen()) {
                return;
            }

            this.openModalWindow();
            this._callbackWindowTitle = callbackWindowTitle;
            this._callbackFunction = callbackFunction;
            this._callbackFunctionParameter = callbackFunctionParameter;
        }

        isOpenHtml() {
            return document.getElementById("modalBox") !== null;
        }

        isOpen() {
            return this.openedByScript || this._resourcesToRefreshOptions.length > 0 || this._storageChanges !== null || document.getElementById("modalBox") !== null;
        }

        closeModalWindow() {
            let modalCloseBtn = document.querySelector('.modal > .modal-close');
            if (modalCloseBtn !== null) {
                // @ts-ignore
                modalCloseBtn.click();
            }

            this.openedByScript = false;
        }

        resetWindowManager() {
            this.openedByScript = false;
            this._callbackWindowTitle = "";
            this._callbackFunction = null;
            this._callbackFunctionParameter = null;
            this._resourcesToRefreshOptions.length = 0; // clear array
            this._openingResourceWindow = null;
        }

        checkCallbacks() {
            // There is no open modal window
            if (!this.isOpen()) {
                return;
            }

            let windowName = this.currentModalWindowTitle;
            //console.log("windowname " + windowName);

            if (this._resourcesToRefreshOptions.length > 0 && this._openingResourceWindow === null && windowName === "") {
                this._openingResourceWindow = this._resourcesToRefreshOptions[0];
                //console.log("opening modal for " + this._resourcesToRefreshOptions[0].name);
                this._openingResourceWindow.openOptions();
                return;
            }

            if (this._storageChanges !== null && this._openingResourceWindow === null && windowName === "") {
                this._openingResourceWindow = this._storageChanges.adjustments[0].resource;
                //console.log("opening modal for " + this._resourcesToRefreshOptions[0].name);
                this._openingResourceWindow.openOptions();
                return;
            }

            // It is open but doesn't have a title?
            if (windowName === "") {
                return;
            }

            if (this._resourcesToRefreshOptions.length > 0 && this._openingResourceWindow !== null) {
                if (this._openingResourceWindow.name == windowName) {
                    this._openingResourceWindow.updateCachedOptions();
                    //console.log("closing modal for " + this._openingResourceWindow.name);
                    this.closeModalWindow();

                    this._resourcesToRefreshOptions.shift();
                    this._openingResourceWindow = null;
                }

                return;
            }

            if (this._storageChanges !== null && this._openingResourceWindow !== null) {
                if (this._openingResourceWindow.name == windowName) {
                    let constructionPerformed = false;

                    if (this._storageChanges.cratesToBuild > 0) {
                        for (let i = 0; i < this._storageChanges.cratesToBuild; i++) {
                            this._openingResourceWindow.tryConstructCrate();
                        }
                        this._storageChanges.cratesToBuild = 0;
                        constructionPerformed = true;
                    }

                    if (this._storageChanges.containersToBuild > 0) {
                        for (let i = 0; i < this._storageChanges.containersToBuild; i++) {
                            this._openingResourceWindow.tryConstructContainer();
                        }
                        this._storageChanges.containersToBuild = 0;
                        constructionPerformed = true;
                    }

                    if (constructionPerformed) {
                        this.closeModalWindow();
                        if (this._storageChanges.adjustments.length === 0) this._storageChanges = null;
                        this._openingResourceWindow = null;
                        return;
                    }

                    if (this._storageChanges.adjustments[0].cratesAdjustment > 0) {
                        for (let i = 0; i < this._storageChanges.adjustments[0].cratesAdjustment; i++) {
                            this._openingResourceWindow.tryAssignCrate();
                        }
                    }

                    if (this._storageChanges.adjustments[0].cratesAdjustment < 0) {
                        this._storageChanges.adjustments[0].cratesAdjustment *= -1;
                        for (let i = 0; i < this._storageChanges.adjustments[0].cratesAdjustment; i++) {
                            this._openingResourceWindow.tryUnassignCrate();
                        }
                    }

                    if (this._storageChanges.adjustments[0].containersAdjustment > 0) {
                        for (let i = 0; i < this._storageChanges.adjustments[0].containersAdjustment; i++) {
                            this._openingResourceWindow.tryAssignContainer();
                        }
                    }

                    if (this._storageChanges.adjustments[0].containersAdjustment < 0) {
                        this._storageChanges.adjustments[0].containersAdjustment *= -1;
                        for (let i = 0; i < this._storageChanges.adjustments[0].containersAdjustment; i++) {
                            this._openingResourceWindow.tryUnassignContainer();
                        }
                    }
                    
                    //console.log("closing modal for " + this._openingResourceWindow.name);
                    this.closeModalWindow();
                    this._storageChanges.adjustments.shift();
                    if (this._storageChanges.adjustments.length === 0) this._storageChanges = null;
                    this._openingResourceWindow = null;
                    return;
                }
            }

            //console.log("checking for general callbacks")

            if (!this.openedByScript) {
                this._callbacks.forEach(callback => {
                    if (callback.windowName === windowName) {
                        //console.log("general callback found for " + windowName)
                        callback.optionsObject.updateCachedOptions();
                    }
                });
            }

            //console.log("checking for specific callbacks - " + this._callbackFunction + " " + this.openedByScript + " " + windowName);

            if (this._callbackFunction !== null && this.openedByScript && windowName === this._callbackWindowTitle) {
                //console.log("specific callback found for " + this._callbackWindowTitle)

                this._callbackFunction(this._callbackFunctionParameter);

                this._callbackWindowTitle = "";
                this._callbackFunction = null;
                this._callbackFunctionParameter = null;

                this.closeModalWindow();
            }

            //console.log("returning");
        }
    }

    class Campaign {
        /**
         * @param {string} name
         * @param {string} id
         * @param {number} rating
         */
        constructor(name, id, rating) {
            this.name = name;
            this.id = id;
            this.rating = rating;
        }
    }

    class WarManager {
        constructor() {
            /** @type {Campaign[]} */
            this.campaignList = [];
        }

        clearCampaignList() {
            this.campaignList = [];
        }

        /**
         * @param {string} name
         * @param {number} rating
         */
        addToCampaignList(name, rating) {
            this.campaignList.push(new Campaign(name, name, rating));
        }

        /**
         * @param {string} campaignId
         * @param {number} campaignMinimumRating
         */
        updateCampaign(campaignId, campaignMinimumRating) {
            let index = findArrayIndex(this.campaignList, "id", campaignId);

            if (index === -1) {
                return;
            }

            this.campaignList[index].rating = campaignMinimumRating;
        }

        isUnlocked() {
            return document.getElementById("garrison").style.display !== "none" && document.querySelector("#garrison .campaign") !== null;
        }

        launchCampaign() {
            if (!this.isUnlocked()) {
                return false;
            }

            //@ts-ignore
            document.querySelector("#garrison .campaign").click();
            return true;
        }

        isMercenaryUnlocked() {
            return document.querySelector("#garrison .first") !== null;
        }

        hireMercenary() {
            if (!this.isMercenaryUnlocked()) {
                return false;
            }

            //@ts-ignore
            document.querySelector("#garrison .first").click();
            return true;
        }

        get currentOffensiveRating() {
            if (!this.isUnlocked()) {
                return 0;
            }

            return parseFloat(document.querySelector("#garrison .header > span:nth-child(2) > span:nth-child(1)").textContent);
        }

        get maxOffensiveRating() {
            if (!this.isUnlocked()) {
                return 0;
            }

            return parseFloat(document.querySelector("#garrison .header > span:nth-child(2) > span:nth-child(2)").textContent);
        }

        get currentSoldiers() {
            if (!this.isUnlocked()) {
                return 0;
            }

            return parseInt(document.querySelector("#garrison .barracks > span:nth-Child(2)").textContent.split(" / ")[0]);
        }

        get maxSoldiers() {
            if (!this.isUnlocked()) {
                return 0;
            }

            return parseInt(document.querySelector("#garrison .barracks > span:nth-Child(2)").textContent.split(" / ")[1]);
        }

        get woundedSoldiers() {
            if (!this.isUnlocked()) {
                return 0;
            }

            return parseInt(document.querySelector("#garrison .barracks:nth-child(2) > span:nth-child(2)").textContent);
        }

        get attackType() {
            if (!this.isUnlocked()) {
                return "";
            }

            return document.querySelector("#tactics .current").textContent;
        }

        increaseCampaignDifficulty() {
            if (!this.isUnlocked()) {
                return false;
            }

            //@ts-ignore
            document.querySelector("#tactics .add").click();
            return true;
        }

        decreaseCampaignDifficulty() {
            if (!this.isUnlocked()) {
                return false;
            }

            //@ts-ignore
            document.querySelector("#tactics .sub").click();
            return true;
        }

        get currentBattalion() {
            if (!this.isUnlocked()) {
                return 0;
            }

            return parseInt(document.querySelector("#battalion .current").textContent);
        }

        addBattalion() {
            if (!this.isUnlocked()) {
                return false;
            }

            //@ts-ignore
            document.querySelector("#battalion .add").click();
            return true;
        }

        removeBattalion() {
            if (!this.isUnlocked()) {
                return false;
            }

            //@ts-ignore
            document.querySelector("#battalion .sub").click();
            return true;
        }

       /**
         * @return {boolean}
         */
        switchToBestAttackType() {
            let offense = this.currentOffensiveRating;
            let currentAttackTypeIndex = findArrayIndex(this.campaignList, "name", this.attackType);

            if (this.campaignList.length === 0 || currentAttackTypeIndex === -1) {
                return false;
            }

            for (let i = this.campaignList.length - 1; i >= 0; i--) {
                let campaign = this.campaignList[i];
                
                if (offense >= campaign.rating && currentAttackTypeIndex < i) {
                    this.increaseCampaignDifficulty();
                    return false;
                }

                if (offense < campaign.rating && currentAttackTypeIndex >= i && i > 0) {
                    this.decreaseCampaignDifficulty();
                    return false;
                }
            }

            return true;
        }
    }

    class JobManager {
        constructor() {
            /** @type {Job[]} */
            this.priorityList = [];
            /** @type {CraftingJob[]} */
            this.craftingJobs = [];
            this.maxJobBreakpoints = -1;

            this._unemployed = new Job("Unemployed", "civ", "-", "free", false);

            this._lastLoopCounter = 0;
            /** @type {Job[]} */
            this._managedPriorityList = [];
        }

        isUnlocked() {
            return this._unemployed.isUnlocked();
        }

        clearPriorityList() {
            this.priorityList.length = 0;
            this._managedPriorityList.length = 0;
        }

        /**
         * @param {Job} job
         */
        addJobToPriorityList(job) {
            job.priority = this.priorityList.length;
            this.priorityList.push(job);
            this.maxJobBreakpoints = Math.max(this.maxJobBreakpoints, job.breakpointMaxs.length);
        }

        /**
         * @param {CraftingJob} job
         */
        addCraftingJob(job) {
            this.craftingJobs.push(job);
        }

        sortByPriority() {
            this.priorityList.sort(function (a, b) { return a.priority - b.priority } );
            this._managedPriorityList.sort(function (a, b) { return a.priority - b.priority } );

            for (let i = 0; i < this.priorityList.length; i++) {
                this.maxJobBreakpoints = Math.max(this.maxJobBreakpoints, this.priorityList[i].breakpointMaxs.length);
            }

            this.craftingJobs.sort(function (a, b) { return a.priority - b.priority } );
        }

        managedPriorityList() {
            if (this._lastLoopCounter != state.loopCounter) {
                this._managedPriorityList.length = 0; // clear array
            }

            if (this._managedPriorityList.length === 0) {
                this._lastLoopCounter = state.loopCounter;
                let evilRace = isEvilRace();

                for (let i = 0; i < this.priorityList.length; i++) {
                    const job = this.priorityList[i];
    
                    if (job.isManaged() && (!evilRace || job !== state.jobs.Lumberjack)) {
                        // Only add craftsmen if we can't manually craft and user has enabled the autocraftsman setting
                        if (!job.isCraftsman() || (job.isCraftsman() && settings.autoCraftsmen && !this.canManualCraft())) {
                            this._managedPriorityList.push(job);
                        }
                    }
                }
            }

            return this._managedPriorityList;
        }

        get unemployed() {
            if (!this._unemployed.isUnlocked()) {
                return 0;
            }

            if (isHunterRace()) {
                return 0;
            }

            return this._unemployed.current;
        }

        get employed() {
            let employed = 0;
            let jobList = this.managedPriorityList();

            for (let i = 0; i < jobList.length; i++) {
                employed += jobList[i].current;
            }

            return employed;
        }

        get totalEmployees() {
            let employees = this.unemployed + this.employed;
            
            return employees;
        }

        get breakpointCount() {
            // We're getting the count of how many breakpoints we have so just use the normal list and get the first one
            return this.priorityList[0].breakpointMaxs.length;
        }

        /**
         * @param {number} breakpoint
         */
        actualForBreakpoint(breakpoint) {
            if (breakpoint < 0 || breakpoint > 1) {
                return 0;
            }

            let total = 0;
            let jobList = this.managedPriorityList();

            for (let i = 0; i < jobList.length; i++) {
                total += Math.max(0, jobList[i].breakpointEmployees(breakpoint));
            }

            return total;
        }

        isFoundryUnlocked() {
            let containerNode = document.getElementById("foundry");
            return containerNode !== null && containerNode.style.display !== "none";
        }

        canManualCraft() {
            return resources.brick.isUnlocked() && resources.brick.isCraftingUnlocked();
        }

        get managedCraftsmen() {
            if (!this.isFoundryUnlocked) {
                return 0;
            }

            let managedCrafters = 0;
            if (state.jobs.Plywood.isManaged()) managedCrafters++;
            if (state.jobs.Brick.isManaged()) managedCrafters++;
            if (state.jobs.WroughtIron.isManaged()) managedCrafters++;
            if (state.jobs.SheetMetal.isManaged()) managedCrafters++;
            if (state.jobs.Mythril.isManaged()) managedCrafters++;
            return managedCrafters;
        }

        get currentCraftsmen() {
            if (!this.isFoundryUnlocked()) {
                return 0;
            }

            let foundryCountNode = document.querySelector("#foundry .count");
            if (foundryCountNode !== null) {
                return getRealNumber(foundryCountNode.textContent.split(" / ")[0]);
            }

            return 0;
        }

        get maxCraftsmen() {
            if (!this.isFoundryUnlocked()) {
                return 0;
            }

            let foundryCountNode = document.querySelector("#foundry .count");
            if (foundryCountNode !== null) {
                return getRealNumber(foundryCountNode.textContent.split(" / ")[1]);
            }

            return 0;
        }

        calculateCraftingMaxs() {
            if (!this.isFoundryUnlocked()) {
                return;
            }

            let foundryCountNode = document.querySelector("#foundry .count");
            if (foundryCountNode === null) {
                return;
            }

            let max = getRealNumber(foundryCountNode.textContent.split(" / ")[1]);
            let remainingJobs = [];

            for (let i = 0; i < this.craftingJobs.length; i++) {
                const job = this.craftingJobs[i];

                if (!settings['craft' + job.resource.id]) {
                    // The job isn't unlocked or the user has said to not craft the resource associated with this job
                    job.max = 0;
                } else if (job === state.jobs.Brick && state.cityBuildings.CementPlant.count === 0) {
                    // We've got no cement plants so don't put any craftsmen on making Brick
                    job.max = 0;
                } else if (job === state.jobs.Mythril && resources.mythril.currentQuantity > 1000 && (resources.mythril.currentQuantity > 10000 || resources.iridium.currentQuantity < 10000)) {
                    // Don't make Mythril if we have too much mythril or too little iridium
                    job.max = 0;
                } else if (!job.isManaged()) {
                    // The user has said to not manage this job
                    job.max = job.current;
                    max -= job.current;
                } else {
                    let setting = parseInt(settings['job_b3_' + job._originalId]);
                    if (setting != -1) {
                        // The user has set a specific max for this job so we'll honour it
                        job.max = setting;
                        max -= setting;
                    } else {
                        remainingJobs.push(job);
                    }
                }
            }

            // Divide the remaining jobs between the remaining crafting jobs
            let remainingWorkersToAssign = max;

            for (let i = 0; i < remainingJobs.length; i++) {
                const job = remainingJobs[i];
                job.max = Math.floor(max / remainingJobs.length);
                remainingWorkersToAssign -= job.max;
            }

            if (remainingWorkersToAssign > 0) {
                for (let i = 0; i < remainingJobs.length; i++) {
                    if (remainingWorkersToAssign > 0) {
                        const job = remainingJobs[i];
                        job.max++;
                        remainingWorkersToAssign--;
                    }
                }
            }
        }
    }

    class BuildingManager {
        constructor() {
            /** @type {Action[]} */
            this.priorityList = [];
            this._lastBuildLoopCounter = 0;
            this._lastStateLoopCounter = 0;
            /** @type {Action[]} */
            this._managedPriorityList = [];
            /** @type {Action[]} */
            this._statePriorityList = [];
            /** @type {Action[]} */
            this._managedStatePriorityList = [];
        }

        updateResourceRequirements() {
            this.priorityList.forEach(building => building.updateResourceRequirements());
        }

        clearPriorityList() {
            this.priorityList.length = 0;
            this._managedPriorityList.length = 0;
            this._statePriorityList.length = 0;
            this._managedStatePriorityList.length = 0;
        }

        /**
         * @param {Action} building
         */
        addBuildingToPriorityList(building) {
            building.priority = this.priorityList.length;
            this.priorityList.push(building);

            if (building.hasConsumption()) {
                this._statePriorityList.push(building);
            }
        }

        sortByPriority() {
            this.priorityList.sort(function (a, b) { return a.priority - b.priority } );
            this._managedPriorityList.sort(function (a, b) { return a.priority - b.priority } );
            this._statePriorityList.sort(function (a, b) { return a.priority - b.priority } );
            this._managedStatePriorityList.sort(function (a, b) { return a.priority - b.priority } );
        }

        managedPriorityList() {
            if (this._lastBuildLoopCounter != state.loopCounter) {
                this._managedPriorityList.length = 0; // clear array
            }

            if (this._managedPriorityList.length === 0) {
                this._lastBuildLoopCounter = state.loopCounter;

                for (let i = 0; i < this.priorityList.length; i++) {
                    const building = this.priorityList[i];
    
                    if (building.isUnlocked() && building.autoBuildEnabled) {
                        this._managedPriorityList.push(building);
                    }
                }
            }

            return this._managedPriorityList;
        }

        managedStatePriorityList() {
            if (this._lastStateLoopCounter != state.loopCounter) {
                this._managedStatePriorityList.length = 0; // clear array
            }

            if (this._managedStatePriorityList.length === 0) {
                this._lastStateLoopCounter = state.loopCounter;

                for (let i = 0; i < this._statePriorityList.length; i++) {
                    const building = this._statePriorityList[i];

                    // If the building doesn't yet have state then it doesn't need to be managed (either not unlocked or tech for state not unlocked)
                    if (building.hasState() && building.autoStateEnabled) {
                        this._managedStatePriorityList.push(building);
                    }
                }
            }

            return this._managedStatePriorityList;
        }
    }

    class Project {
        /**
         * @param {string} name
         * @param {string} id
         */
        constructor(name, id) {
            this.name = name;
            this.id = id;
            this.priority = 0;

            this._autoBuildEnabled = false;
            this._autoMax = -1;

            /** @type {ResourceRequirement[]} */
            this.resourceRequirements = [];
        }

        isUnlocked() {
            return document.querySelector('#arpa' + this.id + ' > div.buy > button.button.x1') !== null;
        }

        updateResourceRequirements() {
            let node = document.querySelector('#arpa' + this.id + ' > div.buy > button.button.x1');

            if (node === null) {
                return;
            }

            let requirementText = node.getAttribute("aria-label");

            if (requirementText === null) {
                return;
            }

            let requirements = requirementText.split(". ");
            let currentIndex = 0;

            // The number of project resource requirements doesn't change over time. The type of resource might (eg. Monument) but not the number
            // So, just add them the first time and update them otherwise
            requirements.forEach(requirement => {
                // Don't proceed if there isn't a requirement, or if it is "Constract 1%", or if it is "Insufficient Brick"
                // It must have a ":", eg.
                // aria-label="Construct 1%. Costs: $ 12.85M. Plywood:  107K. Brick:  85.6K. Insufficient Brick. Wrought Iron:  42.8K."
                if (requirement.trim().length === 0 || requirement.indexOf(":") === -1) {
                    return;
                }

                if (requirement.indexOf("$") !== -1) {
                    if (currentIndex < this.resourceRequirements.length) {
                        this.resourceRequirements[currentIndex].resource = resources.money;
                        this.resourceRequirements[currentIndex].quantity = getRealNumber(requirement.split("$")[1]);
                        currentIndex++;
                    } else {
                        this.resourceRequirements.push(new ResourceRequirement(resources.money, getRealNumber(requirement.split("$")[1])));
                    }
                } else {
                    let requirementArray = requirement.split(":");
                    let indexAdjustment = requirementArray.length === 2 ? 0 : 1;
                    let resourceName = requirement.split(":")[indexAdjustment].trim().toLowerCase().replace(" ", "_");

                    if (resourceName === "souls") { resourceName = "food" }
                    else if (resourceName === "bones") { resourceName = "lumber" }
                    else if (resourceName === "flesh") { resourceName = "furs" }
                    else if (resourceName === "boneweave") { resourceName = "plywood" }

                    // To account for: "42.8K." - note the period at the end there.
                    let quantity = requirement.split(":")[1 + indexAdjustment];
                    if (quantity.endsWith(".")) {
                        quantity = quantity.substring(0, quantity.length - 1);
                    }

                    if (currentIndex < this.resourceRequirements.length) {
                        this.resourceRequirements[currentIndex].resource = resources[resourceName];
                        this.resourceRequirements[currentIndex].quantity = getRealNumber(quantity);
                        currentIndex++;
                    } else {
                        this.resourceRequirements.push(new ResourceRequirement(resources[resourceName], getRealNumber(quantity)));
                    }
                }
            });

            // let logText = this.id;
            // this.resourceRequirements.forEach(requirement => logText += " " + requirement.resource.id + " - " + requirement.quantity + ", ");
            // log("autoStorage", logText);
        }

        get autoBuildEnabled() {
            return this._autoBuildEnabled;
        }

        /**
         * @param {boolean} value
         */
        set autoBuildEnabled(value) {
            this._autoBuildEnabled = value;
        }

        get autoMax() {
            return this._autoMax < 0 ? Number.MAX_SAFE_INTEGER : this._autoMax;
        }

        set autoMax(value) {
            if (value < 0) value = -1;
            this._autoMax = value;
        }

        get level() {
            let rankNode = document.querySelector('#arpa' + this.id + ' .rank');
            if (rankNode === null) {
                return 0;
            }

            let match = rankNode.textContent.match(/\d+/);

            if (match.length > 0) {
                return getRealNumber(match[0]);
            }

            return 0;
        }

        get progress() {
            return getRealNumber(document.querySelector('#arpa' + this.id + ' progress').getAttribute("value"))
        }

        /**
         * @param {boolean} checkBuildEnabled
         */
        tryBuild(checkBuildEnabled) {
            if (checkBuildEnabled && !this.autoBuildEnabled) {
                return false;
            }

            let moneyFloor = 0;
            let moneyRequirement = this.resourceRequirements.find(requirement => requirement.resource === resources.money);
            if (moneyRequirement !== undefined) {
                moneyFloor = moneyRequirement.quantity;
            }

            let btn = document.querySelector('#arpa' + this.id + ' > div.buy > button.button.x1');
            if (btn === null || wouldBreakMoneyFloor(moneyFloor)) {
                return false;
            }

            // @ts-ignore
            btn.click();
            return true;
        }
    }

    class ProjectManager {
        constructor() {
            /** @type {Project[]} */
            this.priorityList = [];
            this._lastLoopCounter = 0;
            /** @type {Project[]} */
            this._managedPriorityList = [];
        }

        updateResourceRequirements() {
            this.priorityList.forEach(project => project.updateResourceRequirements());
        }

        clearPriorityList() {
            this.priorityList.length = 0;
            this._managedPriorityList.length = 0;
        }

        /**
         * @param {Project} project
         */
        addProjectToPriorityList(project) {
            project.priority = this.priorityList.length;
            this.priorityList.push(project);
        }

        sortByPriority() {
            this.priorityList.sort(function (a, b) { return a.priority - b.priority } );
            this._managedPriorityList.sort(function (a, b) { return a.priority - b.priority } );
        }

        managedPriorityList() {
            if (this._lastLoopCounter != state.loopCounter) {
                this._managedPriorityList.length = 0; // clear array
            }

            if (this._managedPriorityList.length === 0) {
                this._lastLoopCounter = state.loopCounter;

                for (let i = 0; i < this.priorityList.length; i++) {
                    const project = this.priorityList[i];

                    //console.log(project.id + " unlocked= " + project.isUnlocked() + " autoBuildEnabled= " + project.autoBuildEnabled + " autoSpace= " + settings.autoSpace)
                    if (project.isUnlocked() && project.autoBuildEnabled) {
                        this._managedPriorityList.push(project);
                    }
                }
            }

            return this._managedPriorityList;
        }
    }

    class MarketManager {
        constructor() {
            /** @type {Resource[]} */
            this.priorityList = [];
            this._lastLoopCounter = 0;

            /** @type {Resource[]} */
            this._sortedTradeRouteSellList = [];
        }

        isUnlocked() {
            let marketTest = document.getElementById("market-qty");
            return marketTest !== null && marketTest.style.display !== "none";
        }

        clearPriorityList() {
            this.priorityList.length = 0;
            this._sortedTradeRouteSellList.length = 0;
        }

        /**
         * @param {Resource} resource
         */
        addResourceToPriorityList(resource) {
            if (resource.isTradable) {
                resource.marketPriority = this.priorityList.length;
                this.priorityList.push(resource);
            }
        }

        sortByPriority() {
            this.priorityList.sort(function (a, b) { return a.marketPriority - b.marketPriority } );
            this._sortedTradeRouteSellList.sort(function (a, b) { return a.marketPriority - b.marketPriority } );
        }

        /** @param {Resource} resource */
        isBuySellUnlocked(resource) {
            return document.querySelector("#market-" + resource.id + " .order") !== null;
        }

        getSortedTradeRouteSellList() {
            if (this._lastLoopCounter != state.loopCounter) {
                this._sortedTradeRouteSellList.length = 0; // clear array
            }

            if (this._sortedTradeRouteSellList.length === 0) {
                this._lastLoopCounter = state.loopCounter;

                for (let i = 0; i < this.priorityList.length; i++) {
                    const resource = this.priorityList[i];

                    if (this.isResourceUnlocked(resource) && (resource.autoTradeBuyEnabled || resource.autoTradeSellEnabled)) {
                        resource.currentTradeRouteBuyPrice = this.getTradeRouteBuyPrice(resource);
                        resource.currentTradeRouteSellPrice = this.getTradeRouteSellPrice(resource);
                        resource.currentTradeRoutes = this.getTradeRoutes(resource);
                        this._sortedTradeRouteSellList.push(resource);
                    }
                }

                this._sortedTradeRouteSellList.sort(function (a, b) { return b.currentTradeRouteSellPrice - a.currentTradeRouteSellPrice } );
            }

            return this._sortedTradeRouteSellList;
        }

        /**
         * @param {number} multiplier
         */
        isMultiplierUnlocked(multiplier) {
            return this.isUnlocked() && document.querySelector("#market-qty input[value='" + multiplier + "']") !== null;
        }

        getMultiplier() {
            if (!this.isUnlocked()) {
                return -1;
            }

            let checked = document.querySelector("#market-qty input:checked");

            if (checked !== null) {
                return getRealNumber(checked["value"]);
            }

            return -1;
        }

        /**
         * @param {number} multiplier
         */
        setMultiplier(multiplier) {
            if (!this.isUnlocked()) {
                return false;
            }

            let multiplierNode = document.querySelector("#market-qty input[value='" + multiplier + "']");

            if (multiplierNode !== null) {
                //@ts-ignore
                multiplierNode.click();
                return true;
            }

            return false;
        }

        /**
         * @param {Resource} resource
         */
        isResourceUnlocked(resource) {
            if (!this.isUnlocked()) {
                return false;
            }

            let node = document.getElementById("market-" + resource.id);
            return node !== null && node.style.display !== "none";
        }

        /**
         * @param {Resource} resource
         */
        getBuyPrice(resource) {
            let priceNodes = document.querySelectorAll("#market-" + resource.id + " .order");

            if (priceNodes !== null && priceNodes.length > 0) {
                return getRealNumber(priceNodes[0].textContent);
            }

            return -1;
        }

        /**
         * @param {Resource} resource
         */
        getSellPrice(resource) {
            let priceNodes = document.querySelectorAll("#market-" + resource.id + " .order");

            if (priceNodes !== null && priceNodes.length > 1) {
                return getRealNumber(priceNodes[1].textContent);
            }

            return -1;
        }

        /**
         * @param {Resource} resource
         */
        buy(resource) {
            if (!this.isResourceUnlocked(resource)) {
                return false;
            }

            let buttons = document.querySelectorAll("#market-" + resource.id + " .order");

            if (buttons !== null && buttons.length > 0) {
                //@ts-ignore
                buttons[0].click();
                return true;
            }

            return false;
        }

        /**
         * @param {Resource} resource
         */
        sell(resource) {
            if (!this.isResourceUnlocked(resource)) {
                return false;
            }

            let buttons = document.querySelectorAll("#market-" + resource.id + " .order");

            if (buttons !== null && buttons.length > 1) {
                //@ts-ignore
                buttons[1].click();
                return true;
            }

            return false;
        }

        getCurrentTradeRoutes() {
            return parseFloat(document.querySelector("#tradeTotal .tradeTotal").textContent.split(" / ")[0].match(/\d+/)[0])
        }

        getMaxTradeRoutes() {
            return parseFloat(document.querySelector("#tradeTotal .tradeTotal").textContent.split(" / ")[1]);
        }

        /**
         * @param {Resource} resource
         */
        getTradeRoutes(resource) {
            return parseFloat(document.querySelector("#market-" + resource.id + " .current").textContent);
        }

        /**
         * @param {Resource} resource
         */
        getTradeRouteQuantity(resource) {
            return parseFloat(document.querySelector("#market-" + resource.id + " .trade .is-primary").getAttribute("data-label").match(/\d+(?:\.\d+)?/g)[0]);
        }

        /**
         * @param {Resource} resource
         */
        getTradeRouteBuyPrice(resource) {
            return parseFloat(document.querySelectorAll("#market-" + resource.id + " .trade .is-primary")[0].getAttribute("data-label").match(/\d+(?:\.\d+)?/g)[1]);
        }

        /**
         * @param {Resource} resource
         */
        getTradeRouteSellPrice(resource) {
            return parseFloat(document.querySelectorAll("#market-" + resource.id + " .trade .is-primary")[1].getAttribute("data-label").match(/\d+(?:\.\d+)?/g)[1]);
        }

        /**
         * @param {Resource} resource
         * @param {number} toAdd
         */
        addTradeRoutes(resource, toAdd) {
            if (!this.isResourceUnlocked(resource)) {
                return false;
            }

            let button = document.querySelector("#market-" + resource.id + " .sub .route");

            if (button !== null) {
                for (let i = 0; i < toAdd; i++) {
                    // @ts-ignore
                    button.click();
                }
                
                return true;
            }

            return false
        }

        /**
         * @param {Resource} resource
         * @param {number} toRemove
         */
        removeTradeRoutes(resource, toRemove) {
            if (!this.isResourceUnlocked(resource)) {
                return false;
            }

            let button = document.querySelector("#market-" + resource.id + " .add .route");

            if (button !== null) {
                for (let i = 0; i < toRemove; i++) {
                    // @ts-ignore
                    button.click();
                }

                return true;
            }

            return false
        }
    }

    class StorageManager {
        constructor() {
            /** @type {Resource[]} */
            this.priorityList = [];

            this._lastLoopCounter = 0;
            /** @type {Resource[]} */
            this._managedPriorityList = [];
        }

        isUnlocked() {
            isResearchUnlocked("containerization");
        }

        clearPriorityList() {
            this.priorityList.length = 0;
            this._managedPriorityList.length = 0;
        }

        /**
         * @param {Resource} resource
         */
        addResourceToPriorityList(resource) {
            if (resource.hasStorage) {
                resource.storagePriority = this.priorityList.length;
                this.priorityList.push(resource);
            }
        }

        sortByPriority() {
            this.priorityList.sort(function (a, b) { return a.storagePriority - b.storagePriority } );
            this._managedPriorityList.sort(function (a, b) { return a.storagePriority - b.storagePriority } );
        }

        managedPriorityList() {
            if (this._lastLoopCounter != state.loopCounter) {
                this._managedPriorityList.length = 0; // clear array
            }

            if (this._managedPriorityList.length === 0) {
                this._lastLoopCounter = state.loopCounter;

                for (let i = 0; i < this.priorityList.length; i++) {
                    const resource = this.priorityList[i];
    
                    if (resource.isManagedStorage()) {
                        this._managedPriorityList.push(resource);
                    }
                }
            }

            return this._managedPriorityList;
        }
    }

    class Race {
        /**
         * @param {String} id
         * @param {String} name
         * @param {boolean} isEvolutionConditional
         * @param {string} evolutionConditionText
         * @param {string} achievementText
         */
        constructor(id, name, isEvolutionConditional, evolutionConditionText, achievementText) {
            this.id = id;
            this.name = name;
            this.isEvolutionConditional = isEvolutionConditional;
            this.evolutionConditionText = evolutionConditionText;
            this.achievementText = achievementText;

            /** @type {Action[]} */
            this.evolutionTree = [];
        }

        /**
         * @param {number} [level]
         */
        isAchievementUnlocked(level) {
            // check if achievement exists and what star level
            // Levels 1,2,3,4,5
            let achievementTitles = document.querySelectorAll("#achievePanel .achievement > span:nth-child(1)");

            if (achievementTitles === null || achievementTitles.length === 0) {
                return false;
            }

            for (let i = 0; i < achievementTitles.length; i++) {
                const node = achievementTitles[i];
                if (node.textContent === this.achievementText) {
                    if (level <= 1) {
                        return true;
                    }

                    let flairNode = node.nextElementSibling.nextElementSibling;

                    if (flairNode === null) {
                        return;
                    }

                    // @ts-ignore
                    if (flairNode.firstElementChild.getAttribute("class") === "star" + level) {
                        return true;
                    }
                }
            }

            return false;
        }
    }
    
    //#endregion Class Declarations

    //#region State and Initialisation

    var resources = {
            // Base resources
            money: new Resource("Money", "res", "Money", false, false, -1, false, -1, false),
            population: new Resource("Population", "res", "Population", false, false, -1, false, -1, false), // The population node is special and its id will change to the race name
            knowledge: new Resource("Knowledge", "res", "Knowledge", false, false, -1, false, -1, false),
            crates: new Resource("Crates", "res", "Crates", false, false, -1, false, -1, false),
            containers: new Resource("Containers", "res", "Containers", false, false, -1, false, -1, false),
            plasmid: new Resource("Plasmid", "res", "Plasmid", false, false, -1, false, -1, false),
            phage: new Resource("Phage", "res", "Phage", false, false, -1, false, -1, false),
            genes: new Resource("Genes", "res", "Genes", false, false, -1, false, -1, false),

            // Special not-really-resources-but-we'll-treat-them-like-resources resources
            power: new Power(),
            luxury_goods: new LuxuryGoods(),
            moon_support: new Support("Moon Support", "srspc_moon"),
            red_support: new Support("Red Support", "srspc_red"),
            sun_support: new Support("Sun Support", "srspc_sun"),
            belt_support: new Support("Belt Support", "srspc_belt"),

            // Basic resources (can trade for these)
            food: new Resource("Food", "res", "Food", true, true, 2, false, -1, false),
            lumber: new Resource("Lumber", "res", "Lumber", true, true, 2,false, -1, false),
            stone: new Resource("Stone", "res", "Stone", true, true, 2, false, -1, false),
            furs: new Resource("Furs", "res", "Furs", true, true, 1, false, -1, false),
            copper: new Resource("Copper", "res", "Copper", true, true, 1, false, -1, false),
            iron: new Resource("Iron", "res", "Iron", true, true, 1, false, -1, false),
            aluminium: new Resource("Aluminium", "res", "Aluminium", true, true, 1, false, -1, false),
            cement: new Resource("Cement", "res", "Cement", true, true, 1, false, -1, false),
            coal: new Resource("Coal", "res", "Coal", true, true, 1, false, -1, false),
            oil: new Resource("Oil", "res", "Oil", false, true, 0.5, false, -1, false),
            uranium: new Resource("Uranium", "res", "Uranium", false, true, 0.25, false, -1, false),
            steel: new Resource("Steel", "res", "Steel", true, true, 0.5, false, -1, false),
            titanium: new Resource("Titanium", "res", "Titanium", true, true, 0.25, false, -1, false),
            alloy: new Resource("Alloy", "res", "Alloy", true, true, 0.2, false, -1, false),
            polymer: new Resource("Polymer", "res", "Polymer", true, true, 0.2, false, -1, false),
            iridium: new Resource("Iridium", "res", "Iridium", true, true, 0.1, false, -1, false),
            helium_3: new Resource("Helium-3", "res", "Helium_3", false, true, 0.1, false, -1, false),

            // Advanced resources (can't trade for these)
            elerium: new Resource("Elerium", "res", "Elerium", false, false, 0.1, false, -1, false),
            neutronium: new Resource("Neutronium", "res", "Neutronium", false, false, 0.1, false, -1, false),
            nano_tube: new Resource("Nano Tube", "res", "Nano_Tube", false, false, 0.1, false, -1, false),
            
            // Craftable resources
            plywood: new Resource("Plywood", "res", "Plywood", false, false, -1, true, 0.5, false),
            brick: new Resource("Brick", "res", "Brick", false, false, -1, true, 0.5, false),
            wrought_iron: new Resource("Wrought Iron", "res", "Wrought_Iron", false, false, -1, true, 0.5, false),
            sheet_metal: new Resource("Sheet Metal", "res", "Sheet_Metal", false, false, -1, true, 0.5, false),
            mythril: new Resource("Mythril", "res", "Mythril", false, false, -1, true, 0.5, false),
    }

    var state = {
        loopCounter: 1,

        windowManager: new ModalWindowManager(),
        warManager: new WarManager(),
        jobManager: new JobManager(),
        buildingManager: new BuildingManager(),
        projectManager: new ProjectManager(),
        marketManager: new MarketManager(),
        storageManager: new StorageManager(),

        minimumMoneyAllowed: 0,
        
        lastStorageBuildCheckLoop: 0,
        
        goal: "Standard",

        /** @type {Resource[]} */
        allResourceList: [],

        /** @type {Resource[]} */
        craftableResourceList: [],

        jobs: {
            // Uncapped jobs
            Farmer: new Job("Farmer", "civ", "-", "farmer", false), // Farmers are calculated based on food rate of change only, ignoring cap
            Lumberjack: new Job("Lumberjack", "civ", "-", "lumberjack", false), // Lumberjacks and quarry workers are special - remaining worker divided between them
            QuarryWorker: new Job("Quarry Worker", "civ", "-", "quarry_worker", false),  // Lumberjacks and quarry workers are special - remaining worker divided between them

            // Capped jobs
            Miner: new Job("Miner", "civ", "-", "miner", false),
            CoalMiner: new Job("Coal Miner", "civ", "-", "coal_miner", false),
            CementWorker: new Job("Cement Plant Worker", "civ", "-", "cement_worker", false), // Cement works are based on cap and stone rate of change
            Entertainer: new Job("Entertainer", "civ", "-", "entertainer", false),
            Professor: new Job("Professor", "civ", "-", "professor", false),
            Scientist: new Job("Scientist", "civ", "-", "scientist", false),
            Banker: new Job("Banker", "civ", "-", "banker", false),
            Colonist: new Job("Colonist", "civ", "-", "colonist", false),
            SpaceMiner: new Job("Space Miner", "civ", "-", "space_miner", false),

            // Crafting jobs
            Plywood: new CraftingJob("Plywood Crafter", "craft", "", "Plywood", true),
            Brick: new CraftingJob("Brick Crafter", "craft", "", "Brick", true),
            WroughtIron: new CraftingJob("Wrought Iron Crafter", "craft", "", "Wrought_Iron", true),
            SheetMetal: new CraftingJob("Sheet Metal Crafter", "craft", "", "Sheet_Metal", true),
            Mythril: new CraftingJob("Mythril Crafter", "craft", "", "Mythril", true),
        },

        evolutions: {
            Rna: new Action("RNA", "evo", "rna", false),
            Dna: new Action("DNA", "evo", "dna", false),
            Membrane: new Action("Membrane", "evo", "membrane", true),
            Organelles: new Action("Organelles", "evo", "organelles", true),
            Nucleus: new Action("Nucleus", "evo", "nucleus", true),
            EukaryoticCell: new Action("Eukaryotic Cell", "evo", "eukaryotic_cell", true),
            Mitochondria: new Action("Mitochondria", "evo", "mitochondria", true),

            SexualReproduction: new Action("", "evo", "sexual_reproduction", false),
                Phagocytosis: new Action("", "evo", "phagocytosis", false),
                    Multicellular: new Action("", "evo", "multicellular", false),
                        BilateralSymmetry: new Action("", "evo", "bilateral_symmetry", false),
                            Arthropods: new Action("", "evo", "athropods", false),
                                Sentience: new Action("", "evo", "sentience", false),
                                Bunker: new Action("", "evo", "bunker", false),
                                Mantis: new Action("", "evo", "mantis", false),
                                Scorpid: new Action("", "evo", "scorpid", false),
                                Antid: new Action("Antid", "evo", "antid", false),

                            Mammals: new Action("", "evo", "mammals", false),
                                Humanoid: new Action("", "evo", "humanoid", false),
                                    Human: new Action("", "evo", "human", false),
                                    Orc: new Action("", "evo", "orc", false),
                                    Elven: new Action("", "evo", "elven", false),
                                    Valdi: new Action("", "evo", "junker", false), // junker challenge
                                Gigantism: new Action("", "evo", "gigantism", false),
                                    Troll: new Action("", "evo", "troll", false),
                                    Ogre: new Action("", "evo", "orge", false),
                                    Cyclops: new Action("", "evo", "cyclops", false),
                                Dwarfism: new Action("", "evo", "dwarfism", false),
                                    Kobold: new Action("", "evo", "kobold", false),
                                    Goblin: new Action("", "evo", "goblin", false),
                                    Gnome: new Action("", "evo", "gnome", false),
                                Animalism: new Action("", "evo", "animalism", false),
                                    Cath: new Action("", "evo", "cath", false),
                                    Wolven: new Action("", "evo", "wolven", false),
                                    Centaur: new Action("", "evo", "centaur", false),
                                Demonic: new Action("", "evo", "demonic", false), // hellscape only
                                    Balorg: new Action("", "evo", "balorg", false),
                                    Imp: new Action("", "evo", "imp", false),

                            Eggshell: new Action("", "evo", "eggshell", false),
                                Endothermic: new Action("", "evo", "endothermic", false),
                                    Arraak: new Action("", "evo", "arraak", false),
                                    Pterodacti: new Action("", "evo", "pterodacti", false),
                                    Dracnid: new Action("", "evo", "dracnid", false),

                                Ectothermic: new Action("", "evo", "ectothermic", false),
                                    Tortoisan: new Action("", "evo", "tortoisan", false),
                                    Gecko: new Action("", "evo", "gecko", false),
                                    Slitheryn: new Action("", "evo", "slitheryn", false),

                            Aquatic: new Action("", "evo", "aquatic", false), // ocean only
                                Sharkin: new Action("", "evo", "sharkin", false),
                                Octigoran: new Action("", "evo", "octigoran", false),



                Chloroplasts: new Action("", "evo", "chloroplasts", false),
                    //Multicellular: new Action("", "evo", "multicellular", false),
                        Poikilohydric: new Action("", "evo", "poikilohydric", false),
                            Bryophyte: new Action("", "evo", "bryophyte", false),
                                Entish: new Action("", "evo", "entish", false),
                                Cacti: new Action("", "evo", "cacti", false),


                Chitin: new Action("", "evo", "chitin", false),
                    //Multicellular: new Action("", "evo", "multicellular", false),
                        Spores: new Action("", "evo", "spores", false),
                            //Bryophyte: new Action("", "evo", "bryophyte", false),
                                Sporgar: new Action("", "evo", "sporgar", false),
                                Shroomi: new Action("", "evo", "shroomi", false),


            //Bunker: new Action("", "evo", "bunker", false),
            Plasmid: new Action("Plasmid", "evo", "plasmid", false),
            Trade: new Action("Trade", "evo", "trade", false),
            Craft: new Action("Craft", "evo", "craft", false),
            Crispr: new Action("Crispr", "evo", "crispr", false),

        },

        /** @type {Race[]} */
        raceAchievementList: [],
        /** @type {Race[][]} */
        raceGroupAchievementList: [ [] ],
        /** @type {Action[]} */
        evolutionChallengeList: [],

        /** @type {Race} */
        evolutionTarget: null,
        /** @type {Race} */
        evolutionFallback: null,
        races: {
            Antid: new Race("antid", "Antid", false, "", "Ophiocordyceps Unilateralis"),
            Mantis: new Race("mantis", "Mantis", false, "", "Praying Unanswered"),
            Scorpid: new Race("scorpid", "Scorpid", false, "", "Pulmonoscorpius"),
            Human: new Race("human", "Human", false, "", "Homo Adeadus"),
            Orc: new Race("orc", "Orc", false, "", "Outlander"),
            Elven: new Race("elven", "Elf", false, "", "The few, the proud, the dead"),
            Troll: new Race("troll", "Troll", false, "", "Bad Juju"),
            Ogre: new Race("orge", "Ogre", false, "", "Too stupid to live"),
            Cyclops: new Race("cyclops", "Cyclops", false, "", "Blind Ambition"),
            Kobold: new Race("kobold", "Kobold", false, "", "Took their candle"),
            Goblin: new Race("goblin", "Goblin", false, "", "Greed before Need"),
            Gnome: new Race("gnome", "Gnome", false, "", "Unathletic"),
            Cath: new Race("cath", "Cath", false, "", "Saber Tooth Tiger"),
            Wolven: new Race("wolven", "Wolven", false, "", "Dire Wolf"),
            Centaur: new Race("centaur", "Centaur", false, "", "Ferghana"),
            Balorg: new Race("balorg", "Balorg", true, "Hellscape planet", "Self immolation"),
            Imp: new Race("imp", "Imp", true, "Hellscape planet", "Deal with the devil"),
            Arraak: new Race("arraak", "Arraak", false, "", "Way of the Dodo"),
            Pterodacti: new Race("pterodacti", "Pterodacti", false, "", "Chicxulub"),
            Dracnid: new Race("dracnid", "Dracnid", false, "", "Desolate Smaug"),
            Tortoisan: new Race("tortoisan", "Tortoisan", false, "", "Circle of Life"),
            Gecko: new Race("gecko", "Gecko", false, "", "No Savings"),
            Slitheryn: new Race("slitheryn", "Slitheryn", false, "", "Final Shedding"),
            Sharkin: new Race("sharkin", "Sharkin", true, "Oceanic planet", "Megalodon"),
            Octigoran: new Race("octigoran", "Octigoran", true, "Oceanic planet", "Calamari"),
            Entish: new Race("entish", "Ent", false, "", "Saruman's Revenge"),
            Cacti: new Race("cacti", "Cacti", false, "", "Desert Deserted"),
            Sporgar: new Race("sporgar", "Sporgar", false, "", "Fungicide"),
            Shroomi: new Race("shroomi", "Shroomi", false, "", "Bad Trip"),
            Valdi: new Race("junker", "Valdi", true, "Challenge genes unlocked", "Euthanasia"),
        },
        
        cityBuildings: {
            Food: new Action("Food", "city", "food", false),
            Lumber: new Action("Lumber", "city", "lumber", false),
            Stone: new Action("Stone", "city", "stone", false),

            Slaughter: new Action("Slaughter", "city", "slaughter", false),

            University: new Action("University", "city", "university", true),
            Wardenclyffe: new Action("Wardenclyffe", "city", "wardenclyffe", true),
            Mine: new Action("Mine", "city", "mine", true),
            CoalMine: new Action("Coal Mine", "city", "coal_mine", true),
            Smelter: new Smelter(),
            CoalPower: new Action("Coal Powerplant", "city", "coal_power", true),
            Temple: new Action("Temple", "city", "temple", true),
            OilWell: new Action("Oil Derrick", "city", "oil_well", true),
            BioLab: new Action("Bioscience Lab", "city", "biolab", true),
            StorageYard: new Action("Freight Yard", "city", "storage_yard", true),
            Warehouse: new Action("Container Port", "city", "warehouse", true),
            OilPower: new Action("Oil Powerplant", "city", "oil_power", true),
            Bank: new Action("Bank", "city", "bank", true),
            Barracks: new Action("Barracks", "city", "garrison", true),
            Hospital: new Action("Hospital", "city", "hospital", true),
            BootCamp: new Action("Boot Camp", "city", "boot_camp", true),
            House: new Action("Cabin", "city", "house", true),
            Cottage: new Action("Cottage", "city", "cottage", true),
            Apartment: new Action("Apartment", "city", "apartment", true),
            Farm: new Action("Farm", "city", "farm", true),
            SoulWell: new Action("Soul Well", "city", "soul_well", true),
            Mill: new Action("Mill", "city", "mill", true),
            Windmill: new Action("Windmill", "city", "windmill", true),
            Silo: new Action("Grain Silo", "city", "silo", true),
            Shed: new Action("Shed", "city", "shed", true),
            LumberYard: new Action("Lumber Yard", "city", "lumber_yard", true),
            RockQuarry: new Action("Rock Quarry", "city", "rock_quarry", true),
            CementPlant: new Action("Cement Factory", "city", "cement_plant", true),
            Foundry: new Action("Foundry", "city", "foundry", true),
            Factory: new Factory(), // Special building with options
            OilDepot: new Action("Fuel Depot", "city", "oil_depot", true),
            Trade: new Action("Trade Post", "city", "trade", true),
            Amphitheatre: new Action("Amphitheatre", "city", "amphitheatre", true),
            Library: new Action("Library", "city", "library", true),
            Sawmill: new Action("Sawmill", "city", "sawmill", true),
            FissionPower: new Action("Fission Reactor", "city", "fission_power", true),
            Lodge: new Action("Lodge", "city", "lodge", true),
            Smokehouse: new Action("Smokehouse", "city", "smokehouse", true),
            Casino: new Action("Casino", "city", "casino", true),
            TouristCenter: new Action("Tourist Center", "city", "tourist_center", true),
            MassDriver: new Action("Mass Driver", "city", "mass_driver", true),
            Wharf: new Action("Wharf", "city", "wharf", true),
            MetalRefinery: new Action("Metal Refinery", "city", "metal_refinery", true),
            SlavePen: new Action("Slave Pen", "city", "slave_pen", true),
        },
        
        spaceBuildings: {
            // Space
            SpaceTestLaunch: new Action("Test Launch", "space", "test_launch", true),
            SpaceSatellite: new Action("Space Satellite", "space", "satellite", true),
            SpaceGps: new Action("Space Gps", "space", "gps", true),
            SpacePropellantDepot: new Action("Space Propellant Depot", "space", "propellant_depot", true),
            SpaceNavBeacon: new Action("Space Navigation Beacon", "space", "nav_beacon", true),
            
            // Moon
            MoonMission: new Action("Moon Mission", "space", "moon_mission", true),
            MoonBase: new Action("Moon Base", "space", "moon_base", true),
            MoonIridiumMine: new Action("Moon Iridium Mine", "space", "iridium_mine", true),
            MoonHeliumMine: new Action("Moon Helium-3 Mine", "space", "helium_mine", true),
            MoonObservatory: new Action("Moon Observatory", "space", "observatory", true),
            
            // Red
            RedMission: new Action("Red Mission", "space", "red_mission", true),
            RedSpaceport: new Action("Red Spaceport", "space", "spaceport", true),
            RedTower: new Action("Red Space Control", "space", "red_tower", true),
            RedLivingQuarters: new Action("Red Living Quarters", "space", "living_quarters", true),
            RedGarage: new Action("Red Garage", "space", "garage", true),
            RedMine: new Action("Red Mine", "space", "red_mine", true),
            RedFabrication: new Action("Red Fabrication", "space", "fabrication", true),
            RedFactory: new Action("Red Factory", "space", "red_factory", true),
            RedBiodome: new Action("Red Biodome", "space", "biodome", true),
            RedExoticLab: new Action("Red Exotic Materials Lab", "space", "exotic_lab", true),
            RedSpaceBarracks: new Action("Red Marine Barracks", "space", "space_barracks", true),
            Ziggurat: new Action("Ziggurat", "space", "ziggurat", true),
            
            // Hell
            HellMission: new Action("Hell Mission", "space", "hell_mission", true),
            HellGeothermal: new Action("Hell Geothermal Plant", "space", "geothermal", true),
            HellSwarmPlant: new Action("Hell Swarm Plant", "space", "swarm_plant", true),
            
            // Sun
            SunMission: new Action("Sun Mission", "space", "sun_mission", true),
            SunSwarmControl: new Action("Sun Control Station", "space", "swarm_control", true),
            SunSwarmSatellite: new Action("Sun Swarm Satellite", "space", "swarm_satellite", true),
            
            // Gas
            GasMission: new Action("Gas Mission", "space", "gas_mission", true),
            GasMining: new Action("Gas Helium-3 Collector", "space", "gas_mining", true),
            GasStorage: new Action("Gas Fuel Depot", "space", "gas_storage", true),
            GasSpaceDock: new SpaceDock(), // Special building with options
            GasSpaceDockProbe: new Action("Gas Space Probe", "spcdock", "probes", true),
            GasSpaceDockShipSegment: new Action("Gas Bioseeder Ship Segment", "spcdock", "seeder", true),
            
            // Gas moon
            GasMoonMission: new Action("Gas Moon Mission", "space", "gas_moon_mission", true),
            GasMoonOutpost: new Action("Gas Moon Mining Outpost", "space", "outpost", true),
            GasMoonDrone: new Action("Gas Moon Mining Drone", "space", "drone", true),
            GasMoonOilExtractor: new Action("Gas Moon Oil Extractor", "space", "oil_extractor", true),
            
            // Belt
            BeltMission: new Action("Belt Mission", "space", "belt_mission", true),
            BeltSpaceStation: new Action("Belt Space Station", "space", "space_station", true),
            BeltEleriumShip: new Action("Belt Elerium Mining Ship", "space", "elerium_ship", true),
            BeltIridiumShip: new Action("Belt Iridium Mining Ship", "space", "iridium_ship", true),
            BeltIronShip: new Action("Belt Iron Mining Ship", "space", "iron_ship", true),
            
            // Dwarf
            DwarfMission: new Action("Dwarf Mission", "space", "dwarf_mission", true),
            DwarfEleriumContainer: new Action("Dwarf Elerium Storage", "space", "elerium_contain", true),
            DwarfEleriumReactor: new Action("Dwarf Elerium Reactor", "space", "e_reactor", true),
            DwarfWorldCollider: new Action("Dwarf World Collider", "space", "world_collider", true),
            DwarfWorldController: new Action("Dwarf WSC Control", "space", "world_controller", true),
        },

        projects: {
            SuperCollider: new Project("Supercollider", "lhc"),
            StockExchange: new Project("Stock Exchange", "stock_exchange"),
            Monument: new Project("Monument", "monument"),
            LaunchFacility: new Project("Launch Facility", "launch_facility"),
        },

        //global: null,
    };

    function initialiseState() {
        resetMarketState();
        resetStorageState();

        // Add general callbacks to the window manager. These will be called if the user opens the window.
        state.windowManager.addGeneralCallback("Smelter", state.cityBuildings.Smelter);
        state.windowManager.addGeneralCallback("Factory", state.cityBuildings.Factory);

        state.storageManager.priorityList.forEach(resource =>
            state.windowManager.addGeneralCallback(resource.name, resource)
        );

        // Construct craftable resource list
        state.craftableResourceList.push(resources.plywood);
        resources.plywood.resourceRequirements.push(new ResourceRequirement(resources.lumber, 100));
        state.craftableResourceList.push(resources.brick);
        resources.brick.resourceRequirements.push(new ResourceRequirement(resources.cement, 40));
        state.craftableResourceList.push(resources.wrought_iron);
        resources.wrought_iron.resourceRequirements.push(new ResourceRequirement(resources.iron, 80));
        state.craftableResourceList.push(resources.sheet_metal);
        resources.sheet_metal.resourceRequirements.push(new ResourceRequirement(resources.aluminium, 120));
        state.craftableResourceList.push(resources.mythril);
        resources.mythril.resourceRequirements.push(new ResourceRequirement(resources.iridium, 100));
        resources.mythril.resourceRequirements.push(new ResourceRequirement(resources.alloy, 250));

        // Lets set our crate / container resource requirements
        resources.crates.resourceRequirements.push(new ResourceRequirement(resources.plywood, 10));
        resources.containers.resourceRequirements.push(new ResourceRequirement(resources.steel, 125));

        // Construct all resource list
        state.allResourceList = state.marketManager.priorityList.concat(state.craftableResourceList);
        state.allResourceList.push(resources.money);
        state.allResourceList.push(resources.population);
        state.allResourceList.push(resources.knowledge);
        state.allResourceList.push(resources.crates);
        state.allResourceList.push(resources.containers);
        state.allResourceList.push(resources.plasmid);
        state.allResourceList.push(resources.genes);
        state.allResourceList.push(resources.power);
        state.allResourceList.push(resources.moon_support);
        state.allResourceList.push(resources.red_support);
        state.allResourceList.push(resources.sun_support);
        state.allResourceList.push(resources.belt_support);
        state.allResourceList.push(resources.neutronium);
        state.allResourceList.push(resources.elerium);
        state.allResourceList.push(resources.nano_tube);

        // TODO: Depending on tech level. Will have to adjust
        // copper: [0.75,1.12,1.49,1.86],
        // aluminium: [1,1.5,2,2.5],
        // output: [0.075,0.112,0.149,0.186]
        resources.alloy.productionCost.push(new ResourceProductionCost(resources.copper, 1.86, 5)); //1.49
        resources.alloy.productionCost.push(new ResourceProductionCost(resources.aluminium, 2, 5)); //0.29
        resources.polymer.productionCost.push(new ResourceProductionCost(resources.oil, 0.45, 2));
        resources.polymer.productionCost.push(new ResourceProductionCost(resources.lumber, 36, 50));
        resources.nano_tube.productionCost.push(new ResourceProductionCost(resources.coal, 20, 5));
        resources.nano_tube.productionCost.push(new ResourceProductionCost(resources.neutronium, 0.125, 0.2));

        state.jobs.Plywood.resource = resources.plywood;
        state.jobManager.addCraftingJob(state.jobs.Plywood);
        state.jobs.Brick.resource = resources.brick;
        state.jobManager.addCraftingJob(state.jobs.Brick);
        state.jobs.WroughtIron.resource = resources.wrought_iron;
        state.jobManager.addCraftingJob(state.jobs.WroughtIron);
        state.jobs.SheetMetal.resource = resources.sheet_metal;
        state.jobManager.addCraftingJob(state.jobs.SheetMetal);
        state.jobs.Mythril.resource = resources.mythril;
        state.jobManager.addCraftingJob(state.jobs.Mythril);

        resetJobState();
        
        // Construct city builds list
        state.spaceBuildings.GasSpaceDock.Probes = state.spaceBuildings.GasSpaceDockProbe;
        state.spaceBuildings.GasSpaceDock.Ship = state.spaceBuildings.GasSpaceDockShipSegment;

        state.cityBuildings.Wardenclyffe.addPowerConsumption(2);
        state.cityBuildings.Mine.addPowerConsumption(1);
        state.cityBuildings.CoalMine.addPowerConsumption(1);
        state.cityBuildings.Smelter.addSmeltingConsumption(SmelterSmeltingTypes.Steel, resources.coal, 0.25, 1.25);
        state.cityBuildings.Smelter.addSmeltingConsumption(SmelterSmeltingTypes.Steel, resources.iron, 2, 6);
        state.cityBuildings.CoalPower.addPowerConsumption(-5);
        state.cityBuildings.CoalPower.addResourceConsumption(resources.coal, 0.35);
        state.cityBuildings.BioLab.addPowerConsumption(2);
        state.cityBuildings.OilPower.addPowerConsumption(-6);
        state.cityBuildings.OilPower.addResourceConsumption(resources.oil, 0.65);
        state.cityBuildings.Apartment.addPowerConsumption(1);
        state.cityBuildings.Mill.addPowerConsumption(-1);
        state.cityBuildings.Windmill.addPowerConsumption(-1);
        state.cityBuildings.RockQuarry.addPowerConsumption(1);
        state.cityBuildings.CementPlant.addPowerConsumption(2);
        state.cityBuildings.Factory.addPowerConsumption(3);
        state.cityBuildings.Sawmill.addPowerConsumption(1);
        state.cityBuildings.FissionPower.addPowerConsumption(-14); // Goes up to 18 after breeder reactor tech researched. This is set in UpdateState().
        state.cityBuildings.FissionPower.addResourceConsumption(resources.uranium, 0.1);
        state.cityBuildings.Casino.addPowerConsumption(5);
        state.cityBuildings.TouristCenter.addResourceConsumption(resources.food, 50);
        state.cityBuildings.MassDriver.addPowerConsumption(5);

        // Construct space buildings list
        state.spaceBuildings.SpaceNavBeacon.addPowerConsumption(2);
        state.spaceBuildings.SpaceNavBeacon.addResourceConsumption(resources.moon_support, -1);
        state.spaceBuildings.MoonBase.addPowerConsumption(4);
        state.spaceBuildings.MoonBase.addResourceConsumption(resources.moon_support, -2);
        state.spaceBuildings.MoonBase.addResourceConsumption(resources.oil, 2);
        state.spaceBuildings.MoonIridiumMine.addResourceConsumption(resources.moon_support, 1);
        state.spaceBuildings.MoonHeliumMine.addResourceConsumption(resources.moon_support, 1);
        state.spaceBuildings.MoonObservatory.addResourceConsumption(resources.moon_support, 1);
        state.spaceBuildings.RedSpaceport.addPowerConsumption(5);
        state.spaceBuildings.RedSpaceport.addResourceConsumption(resources.red_support, -3);
        state.spaceBuildings.RedSpaceport.addResourceConsumption(resources.helium_3, 1.25);
        state.spaceBuildings.RedSpaceport.addResourceConsumption(resources.food, 25);
        state.spaceBuildings.RedTower.addPowerConsumption(2);
        state.spaceBuildings.RedTower.addResourceConsumption(resources.red_support, -1);
        state.spaceBuildings.RedLivingQuarters.addResourceConsumption(resources.red_support, 1);
        state.spaceBuildings.RedMine.addResourceConsumption(resources.red_support, 1);
        state.spaceBuildings.RedFabrication.addResourceConsumption(resources.red_support, 1);
        state.spaceBuildings.RedFactory.addPowerConsumption(3);
        state.spaceBuildings.RedFactory.addResourceConsumption(resources.helium_3, 1);
        state.spaceBuildings.RedBiodome.addResourceConsumption(resources.red_support, 1);
        state.spaceBuildings.RedExoticLab.addResourceConsumption(resources.red_support, 1);
        state.spaceBuildings.RedSpaceBarracks.addResourceConsumption(resources.oil, 2);
        state.spaceBuildings.RedSpaceBarracks.addResourceConsumption(resources.food, 10);
        state.spaceBuildings.HellGeothermal.addPowerConsumption(-8);
        state.spaceBuildings.HellGeothermal.addResourceConsumption(resources.helium_3, 0.5);
        state.spaceBuildings.SunSwarmControl.addResourceConsumption(resources.sun_support, -4);
        state.spaceBuildings.SunSwarmSatellite.addPowerConsumption(-1);
        state.spaceBuildings.SunSwarmSatellite.addResourceConsumption(resources.sun_support, 1);
        state.spaceBuildings.GasMining.addPowerConsumption(2);
        state.spaceBuildings.GasMoonOutpost.addPowerConsumption(3);
        state.spaceBuildings.GasMoonOutpost.addResourceConsumption(resources.oil, 2);
        state.spaceBuildings.GasMoonOilExtractor.addPowerConsumption(1);
        state.spaceBuildings.BeltSpaceStation.addPowerConsumption(3);
        state.spaceBuildings.BeltSpaceStation.addResourceConsumption(resources.belt_support, -3);
        state.spaceBuildings.BeltSpaceStation.addResourceConsumption(resources.food, 10);
        state.spaceBuildings.BeltSpaceStation.addResourceConsumption(resources.helium_3, 2.5);
        state.spaceBuildings.BeltEleriumShip.addResourceConsumption(resources.belt_support, 2);
        state.spaceBuildings.BeltIridiumShip.addResourceConsumption(resources.belt_support, 1);
        state.spaceBuildings.BeltIronShip.addResourceConsumption(resources.belt_support, 1);
        state.spaceBuildings.DwarfEleriumContainer.addPowerConsumption(6);
        state.spaceBuildings.DwarfEleriumReactor.addPowerConsumption(-25);
        state.spaceBuildings.DwarfEleriumReactor.addResourceConsumption(resources.elerium, 0.05);
        state.spaceBuildings.DwarfWorldController.addPowerConsumption(20);

        // We aren't getting these ones yet...
        state.spaceBuildings.GasSpaceDockShipSegment.resourceRequirements.push(new ResourceRequirement(resources.money, 100000));
        state.spaceBuildings.GasSpaceDockShipSegment.resourceRequirements.push(new ResourceRequirement(resources.steel, 25000));
        state.spaceBuildings.GasSpaceDockShipSegment.resourceRequirements.push(new ResourceRequirement(resources.neutronium, 240));
        state.spaceBuildings.GasSpaceDockShipSegment.resourceRequirements.push(new ResourceRequirement(resources.elerium, 10));
        state.spaceBuildings.GasSpaceDockShipSegment.resourceRequirements.push(new ResourceRequirement(resources.nano_tube, 12000));

        resetBuildingState();

        state.evolutionChallengeList.push(state.evolutions.Plasmid);
        state.evolutionChallengeList.push(state.evolutions.Trade);
        state.evolutionChallengeList.push(state.evolutions.Craft);
        state.evolutionChallengeList.push(state.evolutions.Crispr);
        state.evolutionChallengeList.push(state.evolutions.Bunker);

        let e = state.evolutions;

        let bilateralSymmetry = [e.BilateralSymmetry, e.Multicellular, e.Phagocytosis, e.SexualReproduction];

        let aquatic = [e.Sentience, e.Aquatic].concat(bilateralSymmetry);
        state.races.Sharkin.evolutionTree = [e.Sharkin].concat(aquatic);
        state.races.Octigoran.evolutionTree = [e.Octigoran].concat(aquatic);
        state.raceGroupAchievementList.push([ state.races.Sharkin, state.races.Octigoran ]);

        let arthropods = [e.Sentience, e.Arthropods].concat(bilateralSymmetry);
        state.races.Antid.evolutionTree = [e.Antid].concat(arthropods);
        state.races.Scorpid.evolutionTree = [e.Scorpid].concat(arthropods);
        state.races.Mantis.evolutionTree = [e.Mantis].concat(arthropods);
        state.raceGroupAchievementList.push([ state.races.Antid, state.races.Scorpid, state.races.Mantis ]);

        let humanoid = [e.Sentience, e.Humanoid, e.Mammals].concat(bilateralSymmetry);
        state.races.Human.evolutionTree = [e.Human].concat(humanoid);
        state.races.Orc.evolutionTree = [e.Orc].concat(humanoid);
        state.races.Elven.evolutionTree = [e.Elven].concat(humanoid);
        state.races.Valdi.evolutionTree = [e.Valdi, e.Bunker].concat(humanoid); // requires bunker gene
        state.raceGroupAchievementList.push([ state.races.Human, state.races.Orc, state.races.Elven, state.races.Valdi ]);

        let gigantism = [e.Sentience, e.Gigantism, e.Mammals].concat(bilateralSymmetry);
        state.races.Troll.evolutionTree = [e.Troll].concat(gigantism);
        state.races.Ogre.evolutionTree = [e.Ogre].concat(gigantism);
        state.races.Cyclops.evolutionTree = [e.Cyclops].concat(gigantism);
        state.raceGroupAchievementList.push([ state.races.Troll, state.races.Ogre, state.races.Cyclops ]);

        let dwarfism = [e.Sentience, e.Dwarfism, e.Mammals].concat(bilateralSymmetry);
        state.races.Kobold.evolutionTree = [e.Kobold].concat(dwarfism);
        state.races.Goblin.evolutionTree = [e.Goblin].concat(dwarfism);
        state.races.Gnome.evolutionTree = [e.Gnome].concat(dwarfism);
        state.raceGroupAchievementList.push([ state.races.Kobold, state.races.Goblin, state.races.Gnome ]);

        let animalism = [e.Sentience, e.Animalism, e.Mammals].concat(bilateralSymmetry);
        state.races.Cath.evolutionTree = [e.Cath].concat(animalism);
        state.races.Wolven.evolutionTree = [e.Wolven].concat(animalism);
        state.races.Centaur.evolutionTree = [e.Centaur].concat(animalism);
        state.raceGroupAchievementList.push([ state.races.Cath, state.races.Wolven, state.races.Centaur ]);

        let demonic = [e.Sentience, e.Demonic, e.Mammals].concat(bilateralSymmetry);
        state.races.Balorg.evolutionTree = [e.Balorg].concat(demonic);
        state.races.Imp.evolutionTree = [e.Imp].concat(demonic);
        state.raceGroupAchievementList.push([ state.races.Balorg, state.races.Imp ]);

        let endothermic = [e.Sentience, e.Endothermic, e.Eggshell].concat(bilateralSymmetry);
        state.races.Arraak.evolutionTree = [e.Arraak].concat(endothermic);
        state.races.Pterodacti.evolutionTree = [e.Pterodacti].concat(endothermic);
        state.races.Dracnid.evolutionTree = [e.Dracnid].concat(endothermic);
        state.raceGroupAchievementList.push([ state.races.Arraak, state.races.Pterodacti, state.races.Dracnid ]);

        let ectothermic = [e.Sentience, e.Ectothermic, e.Eggshell].concat(bilateralSymmetry);
        state.races.Tortoisan.evolutionTree = [e.Tortoisan].concat(ectothermic);
        state.races.Gecko.evolutionTree = [e.Gecko].concat(ectothermic);
        state.races.Slitheryn.evolutionTree = [e.Slitheryn].concat(ectothermic);
        state.raceGroupAchievementList.push([ state.races.Tortoisan, state.races.Gecko, state.races.Slitheryn ]);

        let chloroplasts = [e.Sentience, e.Bryophyte, e.Poikilohydric, e.Multicellular, e.Chloroplasts, e.SexualReproduction];
        state.races.Entish.evolutionTree = [e.Entish].concat(chloroplasts);
        state.races.Cacti.evolutionTree = [e.Cacti].concat(chloroplasts);
        state.raceGroupAchievementList.push([ state.races.Entish, state.races.Cacti ]);

        let chitin = [e.Sentience, e.Bryophyte, e.Spores, e.Multicellular, e.Chitin, e.SexualReproduction];
        state.races.Sporgar.evolutionTree = [e.Sporgar].concat(chitin);
        state.races.Shroomi.evolutionTree = [e.Shroomi].concat(chitin);
        state.raceGroupAchievementList.push([ state.races.Sporgar, state.races.Shroomi ]);

        state.raceAchievementList.push(state.races.Antid);
        state.raceAchievementList.push(state.races.Human);
        state.raceAchievementList.push(state.races.Troll);
        state.raceAchievementList.push(state.races.Kobold);
        state.raceAchievementList.push(state.races.Cath);
        state.raceAchievementList.push(state.races.Arraak);
        state.raceAchievementList.push(state.races.Tortoisan);
        state.raceAchievementList.push(state.races.Entish);
        state.raceAchievementList.push(state.races.Sporgar);
        state.raceAchievementList.push(state.races.Mantis);
        state.raceAchievementList.push(state.races.Orc);
        state.raceAchievementList.push(state.races.Ogre);
        state.raceAchievementList.push(state.races.Goblin);
        state.raceAchievementList.push(state.races.Wolven);
        state.raceAchievementList.push(state.races.Pterodacti);
        state.raceAchievementList.push(state.races.Gecko);
        state.raceAchievementList.push(state.races.Cacti);
        state.raceAchievementList.push(state.races.Shroomi);
        state.raceAchievementList.push(state.races.Scorpid);
        state.raceAchievementList.push(state.races.Elven);
        state.raceAchievementList.push(state.races.Cyclops);
        state.raceAchievementList.push(state.races.Gnome);
        state.raceAchievementList.push(state.races.Centaur);
        state.raceAchievementList.push(state.races.Dracnid);
        state.raceAchievementList.push(state.races.Slitheryn);
        state.raceAchievementList.push(state.races.Valdi);
        state.raceAchievementList.push(state.races.Sharkin);
        state.raceAchievementList.push(state.races.Octigoran);
        state.raceAchievementList.push(state.races.Balorg);
        state.raceAchievementList.push(state.races.Imp);

        resetProjectState();
        resetWarState();
    }

    function resetWarState() {
        state.warManager.clearCampaignList();

        state.warManager.addToCampaignList("Ambush", 10);
        state.warManager.addToCampaignList("Raid", 50);
        state.warManager.addToCampaignList("Pillage", 100);
        state.warManager.addToCampaignList("Assault", 200);
        state.warManager.addToCampaignList("Siege", 500);
    }

    function resetGeneralSettings() {
        settings.generalMinimumTaxRate = 20;
        settings.generalMaximumMorale = 200;
    }

    function resetEvolutionSettings() {
        settings.userEvolutionTargetName = "auto";
    }

    function resetResearchSettings() {
        settings.userResearchTheology_1 = "auto";
        settings.userResearchTheology_2 = "auto";
        settings.userResearchUnification = "auto";
    }

    function resetMarketState() {
        state.marketManager.clearPriorityList();

        state.marketManager.addResourceToPriorityList(resources.helium_3);
        state.marketManager.addResourceToPriorityList(resources.iridium);
        state.marketManager.addResourceToPriorityList(resources.polymer);
        state.marketManager.addResourceToPriorityList(resources.alloy);
        state.marketManager.addResourceToPriorityList(resources.titanium);
        state.marketManager.addResourceToPriorityList(resources.steel);
        state.marketManager.addResourceToPriorityList(resources.uranium);
        state.marketManager.addResourceToPriorityList(resources.oil);
        state.marketManager.addResourceToPriorityList(resources.coal);
        state.marketManager.addResourceToPriorityList(resources.cement);
        state.marketManager.addResourceToPriorityList(resources.aluminium);
        state.marketManager.addResourceToPriorityList(resources.iron);
        state.marketManager.addResourceToPriorityList(resources.copper);
        state.marketManager.addResourceToPriorityList(resources.furs);
        state.marketManager.addResourceToPriorityList(resources.stone);
        state.marketManager.addResourceToPriorityList(resources.lumber);
        state.marketManager.addResourceToPriorityList(resources.food);

        resources.food.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 10);
        resources.lumber.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 10);
        resources.stone.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 15);
        resources.furs.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 10);
        resources.copper.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 10);
        resources.iron.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 10);
        resources.aluminium.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 10);
        resources.cement.updateMarketState(false, 0.3, false, 0.9, false, 0, true, 10);
        resources.coal.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 10);
        resources.oil.updateMarketState(false, 0.5, false, 0.9, true, 5, false, 10);
        resources.uranium.updateMarketState(false, 0.5, false, 0.9, true, 2, false, 10);
        resources.steel.updateMarketState(false, 0.5, false, 0.9, false, 0, true, 10);
        resources.titanium.updateMarketState(false, 0.8, false, 0.9, true, 50, false, 10);
        resources.alloy.updateMarketState(false, 0.8, false, 0.9, true, 50, false, 10);
        resources.polymer.updateMarketState(false, 0.8, false, 0.9, true, 50, false, 10);
        resources.iridium.updateMarketState(false, 0.8, false, 0.9, true, 50, false, 10);
        resources.helium_3.updateMarketState(false, 0.8, false, 0.9, true, 50, false, 10);
    }

    function resetMarketSettings() {
        settings.tradeRouteMinimumMoneyPerSecond = 200
    }

    function resetStorageState() {
        state.storageManager.clearPriorityList();

        state.storageManager.addResourceToPriorityList(resources.iridium);
        state.storageManager.addResourceToPriorityList(resources.polymer);
        state.storageManager.addResourceToPriorityList(resources.alloy);
        state.storageManager.addResourceToPriorityList(resources.titanium);
        state.storageManager.addResourceToPriorityList(resources.steel);
        state.storageManager.addResourceToPriorityList(resources.coal);
        state.storageManager.addResourceToPriorityList(resources.cement);
        state.storageManager.addResourceToPriorityList(resources.aluminium);
        state.storageManager.addResourceToPriorityList(resources.iron);
        state.storageManager.addResourceToPriorityList(resources.copper);
        state.storageManager.addResourceToPriorityList(resources.furs);
        state.storageManager.addResourceToPriorityList(resources.stone);
        state.storageManager.addResourceToPriorityList(resources.lumber);
        state.storageManager.addResourceToPriorityList(resources.food);

        resources.food.updateStorageState(true, 0, -1, -1);
        resources.lumber.updateStorageState(true, 1, -1, -1);
        resources.stone.updateStorageState(true, 1, -1, -1);
        resources.furs.updateStorageState(true, 1, -1, -1);
        resources.copper.updateStorageState(true, 1, -1, -1);
        resources.iron.updateStorageState(true, 1, -1, -1);
        resources.aluminium.updateStorageState(true, 1, -1, -1);
        resources.cement.updateStorageState(true, 1, -1, -1);
        resources.coal.updateStorageState(true, 1, -1, -1);
        resources.steel.updateStorageState(true, 2, -1, -1);
        resources.titanium.updateStorageState(true, 1, -1, -1);
        resources.alloy.updateStorageState(true, 1, -1, -1);
        resources.polymer.updateStorageState(true, 1, -1, -1);
        resources.iridium.updateStorageState(true, 1, -1, -1);
    }

    function resetStorageSettings() {
        settings.storageLimitPreMad = true;
    }

    function resetJobState() {
        state.jobManager.clearPriorityList();

        state.jobManager.addJobToPriorityList(state.jobs.Farmer);
        state.jobManager.addJobToPriorityList(state.jobs.Lumberjack);
        state.jobManager.addJobToPriorityList(state.jobs.QuarryWorker);
        state.jobManager.addJobToPriorityList(state.jobs.Plywood);
        state.jobManager.addJobToPriorityList(state.jobs.Brick);
        state.jobManager.addJobToPriorityList(state.jobs.WroughtIron);
        state.jobManager.addJobToPriorityList(state.jobs.SheetMetal);
        state.jobManager.addJobToPriorityList(state.jobs.Mythril);
        state.jobManager.addJobToPriorityList(state.jobs.Entertainer);
        state.jobManager.addJobToPriorityList(state.jobs.Scientist);
        state.jobManager.addJobToPriorityList(state.jobs.Professor);
        state.jobManager.addJobToPriorityList(state.jobs.CementWorker);
        state.jobManager.addJobToPriorityList(state.jobs.Miner);
        state.jobManager.addJobToPriorityList(state.jobs.CoalMiner);
        state.jobManager.addJobToPriorityList(state.jobs.Banker);
        state.jobManager.addJobToPriorityList(state.jobs.Colonist);
        state.jobManager.addJobToPriorityList(state.jobs.SpaceMiner);

        state.jobs.Farmer.breakpointMaxs = [0, 0, 0]; // Farmers are calculated based on food rate of change only, ignoring cap
        state.jobs.Lumberjack.breakpointMaxs = [5, 10, 10]; // Lumberjacks and quarry workers are special - remaining worker divided between them
        state.jobs.QuarryWorker.breakpointMaxs = [5, 10, 10]; // Lumberjacks and quarry workers are special - remaining worker divided between them

        state.jobs.SheetMetal.breakpointMaxs = [2, 4, -1];
        state.jobs.Plywood.breakpointMaxs = [2, 4, -1];
        state.jobs.Brick.breakpointMaxs = [2, 4, -1];
        state.jobs.WroughtIron.breakpointMaxs = [2, 4, -1];
        state.jobs.Mythril.breakpointMaxs = [2, 4, -1];

        state.jobs.Scientist.breakpointMaxs = [3, 6, -1];
        state.jobs.Professor.breakpointMaxs = [6, 10, -1];
        state.jobs.Entertainer.breakpointMaxs = [2, 5, -1];
        state.jobs.CementWorker.breakpointMaxs = [4, 8, -1]; // Cement works are based on cap and stone rate of change
        state.jobs.Miner.breakpointMaxs = [3, 5, -1];
        state.jobs.CoalMiner.breakpointMaxs = [2, 4, -1];
        state.jobs.Banker.breakpointMaxs = [3, 5, -1];
        state.jobs.Colonist.breakpointMaxs = [0, 0, -1];
        state.jobs.SpaceMiner.breakpointMaxs = [0, 0, -1];
    }

    function resetBuildingState() {
        state.buildingManager.clearPriorityList();

        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Windmill);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Mill);

        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.SunSwarmControl);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.SunSwarmSatellite);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.CoalPower);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.OilPower);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.FissionPower);

        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Apartment);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Wardenclyffe);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.BioLab);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Mine);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.CementPlant);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.CoalMine);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Factory);

        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasMoonOutpost);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.HellGeothermal); // produces power
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.BeltSpaceStation); // this building resets ui when clicked
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.BeltEleriumShip);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.DwarfEleriumReactor);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.BeltIridiumShip);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.BeltIronShip);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.SpaceNavBeacon);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.MoonBase); // this building resets ui when clicked
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.MoonIridiumMine);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.MoonHeliumMine);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasMining);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedSpaceport); // this building resets ui when clicked
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedTower);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedLivingQuarters);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedFabrication);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedMine);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedBiodome);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedExoticLab); // this building resets ui when clicked
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasMoonOilExtractor);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.DwarfEleriumContainer);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.DwarfWorldController);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedSpaceBarracks);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.MassDriver);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedFactory);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.MoonObservatory);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.TouristCenter);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Casino);

        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.RockQuarry);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Sawmill);

        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.University);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Smelter);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Temple);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.OilWell);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.StorageYard);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Warehouse);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Bank);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Barracks);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Hospital);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.BootCamp);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.House);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Cottage);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Farm);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.SoulWell); // Evil only
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Silo);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Shed);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.LumberYard);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Foundry);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.OilDepot);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Trade);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Amphitheatre);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Library);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Lodge); // Cath only
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Smokehouse); // Cath only
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.Wharf);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.MetalRefinery);
        state.buildingManager.addBuildingToPriorityList(state.cityBuildings.SlavePen); // Evil only

        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.SpaceTestLaunch);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.SpaceSatellite);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.SpaceGps);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.SpacePropellantDepot);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.MoonMission);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedMission);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.RedGarage);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.Ziggurat);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.HellMission);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.HellSwarmPlant);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.SunMission);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasMission);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasStorage);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasSpaceDock);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasSpaceDockProbe);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasSpaceDockShipSegment);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasMoonMission);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.GasMoonDrone);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.BeltMission);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.DwarfMission);
        state.buildingManager.addBuildingToPriorityList(state.spaceBuildings.DwarfWorldCollider);

        for (let i = 0; i < state.buildingManager.priorityList.length; i++) {
            const building = state.buildingManager.priorityList[i];
            
            if (building.id === "probes") {
                building._autoMax = 4;
            } else {
                building._autoMax = -1;
            }
        }
    }

    function resetProjectSettings() {
        settings.arpaBuildIfStorageFull = true;
        settings.arpaBuildIfStorageFullCraftableMin = 50000;
        settings.arpaBuildIfStorageFullResourceMaxPercent = 5;
    }

    function resetProjectState() {
        state.projectManager.clearPriorityList();
        state.projectManager.addProjectToPriorityList(state.projects.SuperCollider);
        state.projectManager.addProjectToPriorityList(state.projects.StockExchange);
        state.projectManager.addProjectToPriorityList(state.projects.Monument);
        state.projectManager.addProjectToPriorityList(state.projects.LaunchFacility);

        for (let i = 0; i < state.projectManager.priorityList.length; i++) {
            state.projectManager.priorityList[i]._autoMax = -1;
        }
    }

    initialiseState();

    var settingsSections = ["generalSettingsCollapsed", "evolutionSettingsCollapsed", "researchSettingsCollapsed", "marketSettingsCollapsed", "storageSettingsCollapsed",
                            "warSettingsCollapsed", "jobSettingsCollapsed", "buildingSettingsCollapsed", "projectSettingsCollapsed"];
    
    function updateStateFromSettings() {
        updateStandAloneSettings();

        // Retrieve settings for battle
        for (let i = 0; i < state.warManager.campaignList.length; i++) {
            let campaign = state.warManager.campaignList[i];

            let settingKey = 'btl_' + campaign.name;
            if (settings.hasOwnProperty(settingKey)) {
                campaign.rating = parseFloat(settings[settingKey]);
            } else {
                settings[settingKey] = campaign.rating;
            }
        }

        // Retrieve settings for resources
        for (let i = 0; i < state.marketManager.priorityList.length; i++) {
            let resource = state.marketManager.priorityList[i];

            let settingKey = 'res_buy_p_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.marketPriority = parseInt(settings[settingKey]); }
            else { settings[settingKey] = resource.marketPriority; }

            settingKey = 'buy' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoBuyEnabled = settings[settingKey]; }
            else { settings[settingKey] = resource.autoBuyEnabled; }

            settingKey = 'res_buy_r_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoBuyRatio = parseFloat(settings[settingKey]); }
            else { settings[settingKey] = resource.autoBuyRatio; }

            settingKey = 'sell' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoSellEnabled = settings[settingKey]; }
            else { settings[settingKey] = resource.autoSellEnabled; }
            
            settingKey = 'res_sell_r_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoSellRatio = parseFloat(settings[settingKey]); }
            else { settings[settingKey] = resource.autoSellRatio; }

            settingKey = 'res_trade_buy_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoTradeBuyEnabled = settings[settingKey]; }
            else { settings[settingKey] = resource.autoTradeBuyEnabled; }

            settingKey = 'res_trade_buy_mtr_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoTradeBuyRoutes = parseInt(settings[settingKey]); }
            else { settings[settingKey] = resource.autoTradeBuyRoutes; }

            settingKey = 'res_trade_sell_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoTradeSellEnabled = settings[settingKey]; }
            else { settings[settingKey] = resource.autoTradeSellEnabled; }

            settingKey = 'res_trade_sell_mps_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoTradeSellMinPerSecond = parseFloat(settings[settingKey]); }
            else { settings[settingKey] = resource.autoTradeSellMinPerSecond; }

            settingKey = 'res_storage' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoStorageEnabled = settings[settingKey]; }
            else { settings[settingKey] = resource.autoStorageEnabled; }

            settingKey = 'res_storage_w_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.autoStorageWeighting = parseFloat(settings[settingKey]); }
            else { settings[settingKey] = resource.autoStorageWeighting; }

            settingKey = 'res_storage_p_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource.storagePriority = parseFloat(settings[settingKey]); }
            else { settings[settingKey] = resource.storagePriority; }

            settingKey = 'res_crates_m_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource._autoCratesMax = parseInt(settings[settingKey]); }
            else { settings[settingKey] = resource._autoCratesMax; }

            settingKey = 'res_containers_m_' + resource.id;
            if (settings.hasOwnProperty(settingKey)) { resource._autoContainersMax = parseInt(settings[settingKey]); }
            else { settings[settingKey] = resource._autoContainersMax; }
        }
        state.marketManager.sortByPriority();
        state.storageManager.sortByPriority();

        // Retrieve settings for crafting resources
        for (let i = 0; i < state.craftableResourceList.length; i++) {
            let settingKey = 'craft' + state.craftableResourceList[i].id;
            if (settings.hasOwnProperty(settingKey)) {
                state.craftableResourceList[i].autoCraftEnabled = settings[settingKey];
            } else {
                settings[settingKey] = defaultAllOptionsEnabled;
            }
        }
        
        // Retrieve settings for buying buildings
        for (let i = 0; i < state.buildingManager.priorityList.length; i++) {
            const building = state.buildingManager.priorityList[i];

            let settingKey = 'bat' + building.id;
            if (settings.hasOwnProperty(settingKey)) {
                building.autoBuildEnabled = settings[settingKey];
            } else {
                settings[settingKey] = building.autoBuildEnabled;
            }

            settingKey = 'bld_p_' + building.id;
            if (settings.hasOwnProperty(settingKey)) {
                building.priority = parseInt(settings[settingKey]);
            } else {
                settings[settingKey] = building.priority;
            }

            settingKey = 'bld_s_' + building.id;
            if (settings.hasOwnProperty(settingKey)) {
                building.autoStateEnabled = settings[settingKey];
            } else {
                settings[settingKey] = building.autoStateEnabled;
            }

            settingKey = 'bld_m_' + building.id;
            if (settings.hasOwnProperty(settingKey)) {
                building.autoMax = parseInt(settings[settingKey]);
            } else {
                settings[settingKey] = building._autoMax;
            }
        }
        state.buildingManager.sortByPriority();

        // Retrieve settings for assigning jobs
        for (let i = 0; i < state.jobManager.priorityList.length; i++) {
            const job = state.jobManager.priorityList[i];

            let settingKey = 'job_' + job._originalId;
            if (settings.hasOwnProperty(settingKey)) {
                job.autoJobEnabled = settings[settingKey];
            } else {
                settings[settingKey] = true; // Don't use defaultAllOptionsEnabled. By default assign all new jobs.
            }

            settingKey = 'job_p_' + job._originalId;
            if (settings.hasOwnProperty(settingKey)) {
                job.priority = parseInt(settings[settingKey]);
            } else {
                settings[settingKey] = job.priority;
            }

            settingKey = 'job_b1_' + job._originalId;
            if (settings.hasOwnProperty(settingKey)) {
                job.setBreakpoint(1, settings[settingKey]);
            } else {
                settings[settingKey] = job.getBreakpoint(1);
            }

            settingKey = 'job_b2_' + job._originalId;
            if (settings.hasOwnProperty(settingKey)) {
                job.setBreakpoint(2, settings[settingKey]);
            } else {
                settings[settingKey] = job.getBreakpoint(2);
            }

            settingKey = 'job_b3_' + job._originalId;
            if (settings.hasOwnProperty(settingKey)) {
                job.setBreakpoint(3, settings[settingKey]);
            } else {
                settings[settingKey] = job.getBreakpoint(3);
            }
        }
        state.jobManager.sortByPriority();

        if (!settings.hasOwnProperty('arpa')) {
            settings.arpa = {
                //lhc: false,
                //stock_exchange: false,
                //monument: false,
                //launch_facility: false,
            };
        }

        for (let i = 0; i < state.projectManager.priorityList.length; i++) {
            const project = state.projectManager.priorityList[i];

            let settingKey = project.id;
            if (settings.arpa.hasOwnProperty(settingKey)) {
                project.autoBuildEnabled = settings.arpa[settingKey];
            } else {
                settings.arpa[settingKey] = project.autoBuildEnabled;
            }

            settingKey = 'arpa_p_' + project.id;
            if (settings.hasOwnProperty(settingKey)) {
                project.priority = parseInt(settings[settingKey]);
            } else {
                settings[settingKey] = project.priority;
            }

            settingKey = 'arpa_m_' + project.id;
            if (settings.hasOwnProperty(settingKey)) {
                project.autoMax = parseInt(settings[settingKey]);
            } else {
                settings[settingKey] = project._autoMax;
            }
        }
        state.projectManager.sortByPriority();
    }

    updateStateFromSettings();

    function updateSettingsFromState() {
        updateStandAloneSettings();

        for (let i = 0; i < state.warManager.campaignList.length; i++) {
            let campaign = state.warManager.campaignList[i];
            settings['btl_' + campaign.name] = campaign.rating;
        }

        for (let i = 0; i < state.buildingManager.priorityList.length; i++) {
            const building = state.buildingManager.priorityList[i];
            settings['bat' + building.id] = building.autoBuildEnabled;
            settings['bld_p_' + building.id] = building.priority;
            settings['bld_s_' + building.id] = building.autoStateEnabled;
            settings['bld_m_' + building.id] = building._autoMax;
        }
        
        for (let i = 0; i < state.craftableResourceList.length; i++) {
            settings['craft' + state.craftableResourceList[i].id] = state.craftableResourceList[i].autoCraftEnabled;
        }

        for (let i = 0; i < state.jobManager.priorityList.length; i++) {
            const job = state.jobManager.priorityList[i];
            settings['job_' + job._originalId] = job.autoJobEnabled;
            settings['job_p_' + job._originalId] = job.priority;
            settings['job_b1_' + job._originalId] = job.getBreakpoint(1);
            settings['job_b2_' + job._originalId] = job.getBreakpoint(2);
            settings['job_b3_' + job._originalId] = job.getBreakpoint(3);
        }

        for (let i = 0; i < state.marketManager.priorityList.length; i++) {
            let resource = state.marketManager.priorityList[i];
            settings['res_buy_p_' + resource.id] = resource.marketPriority;
            settings['buy' + resource.id] = resource.autoBuyEnabled;
            settings['res_buy_r_' + resource.id] = resource.autoBuyRatio;
            settings['sell' + resource.id] = resource.autoSellEnabled;
            settings['res_sell_r_' + resource.id] = resource.autoSellRatio;
            settings['res_trade_buy_' + resource.id] = resource.autoTradeBuyEnabled;
            settings['res_trade_buy_mtr_' + resource.id] = resource.autoTradeBuyRoutes;
            settings['res_trade_sell_' + resource.id] = resource.autoTradeSellEnabled;
            settings['res_trade_sell_mps_' + resource.id] = resource.autoTradeSellMinPerSecond;
            settings['res_storage' + resource.id] = resource.autoStorageEnabled;
            settings['res_storage_w_' + resource.id] = resource.autoStorageWeighting;
            settings['res_storage_p_' + resource.id] = resource.storagePriority;
            settings['res_crates_m_' + resource.id] = resource._autoCratesMax;
            settings['res_containers_m_' + resource.id] = resource._autoContainersMax;
        }

        if (!settings.hasOwnProperty('arpa')) {
            settings.arpa = {
                //lhc: false,
                //stock_exchange: false,
                //monument: false,
                //launch_facility: false,
            };
        }

        for (let i = 0; i < state.projectManager.priorityList.length; i++) {
            const project = state.projectManager.priorityList[i];
            settings.arpa[project.id] = project.autoBuildEnabled;
            settings['arpa_p_' + project.id] = project.priority;
            settings['arpa_m_' + project.id] = project._autoMax;
        }

        localStorage.setItem('settings', JSON.stringify(settings));
    }

    updateSettingsFromState();

    /**
     * @param {string} settingName
     * @param {any} defaultValue
     */
    function addSetting(settingName, defaultValue) {
        if (!settings.hasOwnProperty(settingName)) {
            settings[settingName] = defaultValue;
        }
    }

    function updateStandAloneSettings() {
        settings['scriptName'] = "TMVictor";

        addSetting("storageLimitPreMad", true);
        addSetting("arpaBuildIfStorageFull", true);
        addSetting("arpaBuildIfStorageFullCraftableMin", 50000);
        addSetting("arpaBuildIfStorageFullResourceMaxPercent", 5);

        addSetting("autoEvolution", defaultAllOptionsEnabled);
        addSetting("autoAchievements", false);
        addSetting("autoChallenge", false);
        addSetting("autoMarket", defaultAllOptionsEnabled);
        addSetting("autoFight", defaultAllOptionsEnabled);
        addSetting("autoCraft", defaultAllOptionsEnabled);
        addSetting("autoARPA", defaultAllOptionsEnabled);
        addSetting("autoBuild", defaultAllOptionsEnabled);
        addSetting("autoResearch", defaultAllOptionsEnabled);
        addSetting("autoJobs", defaultAllOptionsEnabled);
        addSetting("autoTax", defaultAllOptionsEnabled);
        addSetting("autoCraftsmen", defaultAllOptionsEnabled);
        addSetting("autoPower", defaultAllOptionsEnabled);

        // Move autoTradeSpecialResources to autoStorage and the delete the setting as it has been moved to autoMarket
        if (settings.hasOwnProperty('autoTradeSpecialResources')) {
            settings.autoStorage = settings.autoTradeSpecialResources;
            delete settings.autoTradeSpecialResources;
        }

        addSetting("buildingStateAll", defaultAllOptionsEnabled);
        addSetting("buildingStateAll", defaultAllOptionsEnabled);
        addSetting("autoStorage", defaultAllOptionsEnabled);
        addSetting("autoSmelter", defaultAllOptionsEnabled);
        addSetting("autoFactory", defaultAllOptionsEnabled);
        addSetting("autoMAD", false);
        addSetting("autoSpace", false); // Space currently equals less plasmids so off by default. Also kind of conflicts with MAD don't you think?
        addSetting("autoSeeder", false);
        addSetting("autoAssembleGene", false);

        addSetting("minimumMoney", 0);
        addSetting("minimumMoneyPercentage", 0);
        addSetting("tradeRouteMinimumMoneyPerSecond", 300);
        addSetting("generalMinimumTaxRate", 20);
        addSetting("generalMaximumMorale", 200);

        addSetting("userEvolutionTargetName", "auto");
        addSetting("userResearchTheology_1", "auto");
        addSetting("userResearchTheology_2", "auto");
        addSetting("userResearchUnification", "auto");
        
        addSetting("buildingEnabledAll", false);
        addSetting("buildingStateAll", false);

        // Collapse or expand settings sections
        for (let i = 0; i < settingsSections.length; i++) {
            addSetting(settingsSections[i], true);
        }
    }

    // #endregion State and Initialisation

    //#region Auto Evolution

    function autoEvolution() {
        if ($('#evolution') === null || $('#evolution')[0].style.display === 'none') {
            return;
        }

        // If we have performed a soft reset with a bioseeded ship then we get to choose our planet
        autoPlanetSelection();

        // Gather some resources and evolve (currently targeting Antids)
        autoGatherResource(state.evolutions.Rna, 10);
        autoGatherResource(state.evolutions.Dna, 10);

        buildIfCountLessThan(state.evolutions.Membrane, 10);
        buildIfCountLessThan(state.evolutions.Organelles, 15);
        buildIfCountLessThan(state.evolutions.Nucleus, 5);
        buildIfCountLessThan(state.evolutions.EukaryoticCell, 5);
        buildIfCountLessThan(state.evolutions.Mitochondria, 3);

        if (settings.autoChallenge) {
            for (let i = 0; i < state.evolutionChallengeList.length; i++) {
                // If we successfully click a challenge then return so the ui has time to update
                if (state.evolutionChallengeList[i].click()) {
                    return;
                }
            }
        }

        // If the user has specified a target evolution then use that
        if (state.evolutionTarget === null && settings.userEvolutionTargetName != "auto") {
            state.evolutionTarget = state.raceAchievementList[findArrayIndex(state.raceAchievementList, "name", settings.userEvolutionTargetName)];
            state.evolutionFallback = state.races.Antid;

            console.log("Targeting user specified race: " + state.evolutionTarget.name + " with fallback race of " + state.evolutionFallback.name);
        } else if (state.evolutionTarget === null) {
            // User has automatic race selection enabled - Antids or autoAchievements
            state.evolutionTarget = state.races.Antid;
            state.evolutionFallback = state.races.Antid;

            if (settings.autoAchievements) {
                const achievementLevel = settings.autoChallenge ? 5 : 1; // If autoChallenge set then go for full 5 stars
                let targetedGroup = { group: null, race: null, remainingPercent: 0 };
                let fallbackGroup = { group: null, race: null, remainingPercent: 0 };

                for (let i = 0; i < state.raceGroupAchievementList.length; i++) {
                    const raceGroup = state.raceGroupAchievementList[i];
                    let remainingAchievements = 0;
                    let remainingRace = null;
                    
                    for (let j = 0; j < raceGroup.length; j++) {
                        const race = raceGroup[j];
                        if (!race.isAchievementUnlocked(achievementLevel) && !race.isEvolutionConditional) { // Just ignore conditional races for now
                            remainingRace = race;
                            remainingAchievements++;
                        }
                    }

                    // We'll target the group with the highest percentage chance of getting an achievement
                    let remainingPercent = remainingAchievements / raceGroup.length;

                    // If this group has the most races left with remaining achievements then target an uncompleted race in this group
                    if (remainingPercent > targetedGroup.remainingPercent) {
                        targetedGroup.group = raceGroup;
                        targetedGroup.race = remainingRace;
                        targetedGroup.remainingPercent = remainingPercent;
                    }

                    // Just in case the targeted race has a condition attached (eg. acquatic requires an ocean world) then have a fallback... just in case
                    if (remainingPercent > fallbackGroup.remainingPercent && !remainingRace.isEvolutionConditional) {
                        fallbackGroup.group = raceGroup;
                        fallbackGroup.race = remainingRace;
                        fallbackGroup.remainingPercent = remainingPercent;
                    }
                }

                if (targetedGroup.group != null) { state.evolutionTarget = targetedGroup.race; }
                if (fallbackGroup.group != null) { state.evolutionFallback = fallbackGroup.race; }
            }

            console.log("Script chosen race: " + state.evolutionTarget.name + " with fallback race of " + state.evolutionFallback.name);
        }

        // Lets go for our targeted evolution
        let targetedEvolutionFound = false;
        for (let i = 0; i < state.evolutionTarget.evolutionTree.length; i++) {
            if (state.evolutionTarget.evolutionTree[i].isUnlocked()) {
                targetedEvolutionFound = true;

                if (state.evolutionTarget.evolutionTree[i].click()) {
                    // If we successfully click the action then return to give the ui some time to refresh
                    return;
                } else {
                    // Our path is unlocked but we can't click it yet
                    break;
                }
            }
        }

        // If we can't find our targeted evolution then use the fallback (eg. our target is an Aquatic race but we're not on an ocean planet)
        if (!targetedEvolutionFound && state.evolutionTarget.isEvolutionConditional) {
            for (let i = 0; i < state.evolutionFallback.evolutionTree.length; i++) {
                if (state.evolutionFallback.evolutionTree[i].click()) {
                    // If we successfully click the action then return to give the ui some time to refresh
                    return;
                }
            }
        }
    }

    function autoPlanetSelection() {
        // This section is for if we bioseeded life and we get to choose our path a little bit
        let potentialPlanets = document.querySelectorAll('#evolution .action');
        let selectedPlanet = "";
        
        selectedPlanet = evolutionPlanetSelection(potentialPlanets, "Grassland");
        if (selectedPlanet === "") { selectedPlanet = evolutionPlanetSelection(potentialPlanets, "Forest"); }
        if (selectedPlanet === "") { selectedPlanet = evolutionPlanetSelection(potentialPlanets, "Oceanic"); }
        if (selectedPlanet === "") { selectedPlanet = evolutionPlanetSelection(potentialPlanets, "Desert"); }
        if (selectedPlanet === "") { selectedPlanet = evolutionPlanetSelection(potentialPlanets, "Volcanic"); }
        if (selectedPlanet === "") { selectedPlanet = evolutionPlanetSelection(potentialPlanets, "Tundra"); }

        // This one is a little bit special. We need to trigger the "mouseover" first as it creates a global javascript varaible
        // that is then destroyed in the "click"
        if (selectedPlanet !== "") {
            let evObj = document.createEvent("Events");
            evObj.initEvent("mouseover", true, false);
            document.getElementById(selectedPlanet).dispatchEvent(evObj);
            // @ts-ignore
            document.getElementById(selectedPlanet).children[0].click()
        }
    }

    function evolutionPlanetSelection (potentialPlanets, planetType) {
        for (let i = 0; i < potentialPlanets.length; i++) {
            if (potentialPlanets[i].id.startsWith(planetType)) {
                // @ts-ignore
                //potentialPlanets[i].children[0].click();
                return potentialPlanets[i].id;
            }
        }

        return "";
    }

    //#endregion Auto Evolution

    //#region Auto Crafting

    function autoCraft() {
        if (!resources.population.isUnlocked()) {
            return;
        }
        
        for (let i = 0; i < state.craftableResourceList.length; i++) {
            let craftable = state.craftableResourceList[i];
            if (!craftable.isUnlocked()) {
                continue;
            }

            if (craftable.autoCraftEnabled) {
                updateCraftRatio(craftable);

                let tryCraft = true;

                if (craftable === resources.mythril) {
                    if (resources.mythril.currentQuantity < 1000) {
                        tryCraft = true;
                    } else if (resources.mythril.currentQuantity > 10000 || resources.iridium.currentQuantity < 10000) {
                        tryCraft = false;
                    }
                }

                //console.log("resource: " + craftable.id + ", length: " + craftable.requiredResources.length);
                for (let i = 0; i < craftable.resourceRequirements.length; i++) {
                    //console.log("resource: " + craftable.id + " required resource: " + craftable.requiredResources[i].id);
                    if (craftable.resourceRequirements[i].resource.storageRatio < craftable.craftRatio) {
                        tryCraft = false;
                    }
                }

                if (tryCraft) {
                    craftable.tryCraftX("5");
                }
            }
        }
    }

    /**
     * @param {Resource} craftable
     */
    function updateCraftRatio(craftable) {
        // We want to get to a healthy number of buildings that require craftable materials so leaving crafting ratio low early
        if (craftable === resources.plywood) {
            craftable.craftRatio = 0.9;
            
            if (state.cityBuildings.Library.count < 20 || state.cityBuildings.Cottage.count < 20) {
                craftable.craftRatio = 0.5;
            }
        }
        
        if (craftable === resources.brick) {
            craftable.craftRatio = 0.9;
            
            if (state.cityBuildings.Library.count < 20 || state.cityBuildings.Cottage.count < 20) {
                craftable.craftRatio = 0.5;
            }
        }
        
        if (craftable === resources.wrought_iron) {
            craftable.craftRatio = 0.9;
            
            if (state.cityBuildings.Cottage.count < 20) {
                craftable.craftRatio = 0.5;
            }
        }
        
        if (craftable === resources.sheet_metal) {
            craftable.craftRatio = 0.9;
            
            if (state.cityBuildings.Wardenclyffe.count < 20) {
                craftable.craftRatio = 0.5;
            }
        }
    }

    //#endregion Auto Crafting

    //#region Auto Battle

    function autoBattle() {
        if (!state.warManager.isUnlocked()) {
            return;
        }

        // Don't send our troops out if we're preparing for MAD as we need all troops at home for maximum plasmids
        if (state.goal === "PreparingMAD") {
            state.warManager.hireMercenary(); // but hire mercenaries if we can afford it to get there quicker
            return;
        }
        
        // Don't launch an attack until we are happy with our battalion size (returns true if we've added a battalion)
        if (state.warManager.currentSoldiers > state.warManager.currentBattalion) {
            if (state.warManager.addBattalion()) {
                return;
            }
        }
        
        // If we're switching attack types this loop then don't launch an attack. Wait for the UI to catch up (returns true when we are at the right attack type)
        if (!state.warManager.switchToBestAttackType()) {
            return;
        }

        // If we have solders, they're not wounded and they're ready to go, then charge!
        if (state.warManager.maxSoldiers !== 0 && state.warManager.woundedSoldiers === 0 && state.warManager.currentSoldiers === state.warManager.maxSoldiers) {
            state.warManager.launchCampaign();
        }
    }

    //#endregion Auto Battle
    
    //#region Auto Jobs

    function autoJobs() {
        state.jobManager.calculateCraftingMaxs();
        let jobList = state.jobManager.managedPriorityList();

        // No jobs unlocked yet
        if (jobList.length === 0) {
            return;
        }

        let quarryWorkerIndex = jobList.indexOf(state.jobs.QuarryWorker);
        let lumberjackIndex = -1;
        
        if (!isEvilRace()) {
            lumberjackIndex = jobList.indexOf(state.jobs.Lumberjack);
        } else {
            lumberjackIndex = jobList.indexOf(state.jobs.Farmer);
        }

        let breakpoint0Max = 0;
        let breakpoint1Max = 0;

        // Cath / Balorg / Imp race doesn't have farmers, unemployed are their farmers
        if (isHunterRace()) {
            for (let i = 0; i < jobList.length; i++) {
                const job = jobList[i];
                breakpoint0Max += job.breakpointEmployees(0);
                breakpoint1Max += job.breakpointEmployees(1);
            }

            log("autoJobs", "Max breakpoint 0: " + breakpoint0Max)
            log("autoJobs", "Max breakpoint 1: " + breakpoint1Max)
        }

        let availableEmployees = state.jobManager.totalEmployees;
        let requiredJobs = [];
        let jobAdjustments = [];

        // First figure out how many farmers are required
        if (state.jobs.Farmer.isManaged()) {
            if (!state.jobs.Lumberjack.isUnlocked() && !state.jobs.QuarryWorker.isUnlocked()) {
                // No other jobs are unlocked - everyone on farming!
                requiredJobs.push(availableEmployees);
                log("autoJobs", "Pushing all farmers")
            } else if (resources.food.storageRatio < 0.2 && resources.food.rateOfChange < 0) {
                // We want food to fluctuate between 0.2 and 0.8 only. We only want to add one per loop until positive
                requiredJobs.push(Math.min(state.jobs.Farmer.current + 1, availableEmployees));
                log("autoJobs", "Adding one farmer")
            } else if (resources.food.storageRatio > 0.8 && resources.food.rateOfChange > 0) {
                // We want food to fluctuate between 0.2 and 0.8 only. We only want to remove one per loop until negative
                requiredJobs.push(Math.max(state.jobs.Farmer.current - 1, 0));
                log("autoJobs", "Removing one farmer")
            } else if (isHunterRace() && resources.food.storageRatio > 0.3 && resources.food.rateOfChange > resources.population.currentQuantity / 10) {
                // Carnivore race. Put We've got some food so put them to work!
                requiredJobs.push(Math.max(state.jobs.Farmer.current - 1, 0));
                log("autoJobs", "Removing one farmer - Carnivore")
            } else {
                // We're good; leave farmers as they are
                requiredJobs.push(state.jobs.Farmer.current);
                log("autoJobs", "Leaving current farmers")
            }

            log("autoJobs", "currentQuantity " + resources.population.currentQuantity + " breakpoint1Max " + breakpoint1Max + " requiredJobs[0] " + requiredJobs[0] + " breakpointEmployees(1) " + state.jobs.Lumberjack.breakpointEmployees(1) +  " breakpointEmployees(0) " + state.jobs.Lumberjack.breakpointEmployees(0))
            if (isEvilRace()) {
                if (resources.population.currentQuantity > breakpoint0Max && requiredJobs[0] < state.jobs.Lumberjack.breakpointEmployees(1)) {
                    log("autoJobs", "Setting required hunters to breakpoint 1")
                    requiredJobs[0] = state.jobs.Lumberjack.breakpointEmployees(1);
                } else if (requiredJobs[0] < state.jobs.Lumberjack.breakpointEmployees(0)) {
                    log("autoJobs", "Setting required hunters to breakpoint 0")
                    requiredJobs[0] = state.jobs.Lumberjack.breakpointEmployees(0);
                }
            }

            jobAdjustments.push(requiredJobs[0] - state.jobs.Farmer.current);
            availableEmployees -= requiredJobs[0];
        }

        for (let i = 0; i < state.jobManager.maxJobBreakpoints; i++) {
            for (let j = 0; j < jobList.length; j++) {
                const job = jobList[j];

                // We've already done the farmer above
                if (job === state.jobs.Farmer) {
                    continue;
                }

                if (i !== 0) {
                    // If we're going up to the next breakpoint then add back the workers from this job from the last one
                    // so that we don't double-take them
                    availableEmployees += requiredJobs[j];
                }

                log("autoJobs", "job " + job._originalId + " job.breakpointEmployees(i) " + job.breakpointEmployees(i) + " availableEmployees " + availableEmployees);
                let jobsToAssign = Math.min(availableEmployees, job.breakpointEmployees(i));

                // Don't assign bankers if our money is maxed and bankers aren't contributing to our money storage cap
                if (job === state.jobs.Banker && !isResearchUnlocked("swiss_banking") && resources.money.storageRatio > 0.98) {
                    jobsToAssign = 0;
                }

                // Races with the Intelligent trait get bonus production based on the number of professors and scientists
                // Only unassign them when knowledge is max if the race is not intelligent
                // Once we've research shotgun sequencing we get boost and soon autoassemble genes so stop unassigning
                if (!isRaceTraitIntelligent(getRaceId()) && !isResearchUnlocked("shotgun_sequencing")) {
                    // Don't assign professors if our knowledge is maxed and professors aren't contributing to our temple bonus
                    if (job === state.jobs.Professor && !isResearchUnlocked("indoctrination") && resources.knowledge.storageRatio > 0.98) {
                        jobsToAssign = 0;
                    }

                    // Don't assign scientists if our knowledge is maxed and scientists aren't contributing to our knowledge cap
                    if (job === state.jobs.Scientist && !isResearchUnlocked("scientific_journal") && resources.knowledge.storageRatio > 0.98) {
                        jobsToAssign = 0;
                    }
                }

                if (job === state.jobs.CementWorker) {
                    let currentCementWorkers = job.current;
                    log("autoJobs", "jobsToAssign: " + jobsToAssign + ", currentCementWorkers" + currentCementWorkers + ", resources.stone.rateOfChange " + resources.stone.rateOfChange);

                    if (jobsToAssign < currentCementWorkers) {
                        // great, remove workers as we want less than we have
                    } else if (jobsToAssign >= currentCementWorkers && resources.stone.rateOfChange < 5) {
                        // If we're making less than 5 stone then lets remove a cement worker even if we want more
                        jobsToAssign = job.current - 1;
                    } else if (jobsToAssign > job.current && resources.stone.rateOfChange > 8) {
                        // If we want more cement workers and we're making more than 8 stone then add a cement worker
                        jobsToAssign = job.current + 1;
                    } else {
                        // We're not making enough stone to add a new cement worker so leave it
                        jobsToAssign = job.current;
                    }
                }

                if (i === 0) {
                    requiredJobs.push(jobsToAssign);
                    jobAdjustments.push(jobsToAssign - job.current);
                } else {
                    requiredJobs[j] = jobsToAssign;
                    jobAdjustments[j] = jobsToAssign - job.current;
                }
                
                availableEmployees -= jobsToAssign;

                log("autoJobs", "job " + job._originalId +  " has jobsToAssign: " + jobsToAssign + ", availableEmployees " + availableEmployees);
            }

            // No more workers available
            if (availableEmployees <= 0) {
                break;
            }
        }

        // Balance lumberjacks and quarry workers if they are unlocked
        if (lumberjackIndex !== -1 || quarryWorkerIndex !== -1) {
            if (availableEmployees >= 0 && lumberjackIndex === -1) {
                // No lumber jacks so can only have quarry workers
                requiredJobs[quarryWorkerIndex] += availableEmployees;
                jobAdjustments[quarryWorkerIndex] += availableEmployees;
                availableEmployees = 0
            } else if (availableEmployees >= 0 && quarryWorkerIndex === -1) {
                // No quarry workers so can only have lumber jacks
                requiredJobs[lumberjackIndex] += availableEmployees;
                jobAdjustments[lumberjackIndex] += availableEmployees;
                availableEmployees = 0
            } else {
                if (!isEvilRace()) {
                    let lumberjacks = 0;
                    availableEmployees += requiredJobs[lumberjackIndex];
                    requiredJobs[lumberjackIndex] = 0;
                    jobAdjustments[lumberjackIndex] = 0 - state.jobs.Lumberjack.current;
                    availableEmployees += requiredJobs[quarryWorkerIndex];
                    requiredJobs[quarryWorkerIndex] = 0;
                    jobAdjustments[quarryWorkerIndex] = 0 - state.jobs.QuarryWorker.current;

                    // If we've got over 100 population then keep lumberjacks 5 more than quarry workers (due to sawmills providing bonus)
                    if (resources.population.currentQuantity >= 100) {
                        lumberjacks = Math.min(availableEmployees, 4);
                        requiredJobs[lumberjackIndex] += lumberjacks;
                        jobAdjustments[lumberjackIndex] += lumberjacks;
                        availableEmployees -= lumberjacks;
                    }

                    // Split the remainder between lumberjacks and quarry workers
                    lumberjacks = Math.ceil(availableEmployees / 2);
                    requiredJobs[lumberjackIndex] += lumberjacks;
                    jobAdjustments[lumberjackIndex] += lumberjacks;
                    availableEmployees -= lumberjacks;
                    requiredJobs[quarryWorkerIndex] += availableEmployees;
                    jobAdjustments[quarryWorkerIndex] += availableEmployees;
                } else {
                    // Evil races are a little bit different. Their "umemployed" workers act as both farmers and lumberjacks
                    // We need to keep a minimum number on farming. Distribute all available workers first to quarry workers
                    // until they are equal to lumberjacks and then equally for the rest.
                    while (availableEmployees >= 1) {
                        if (requiredJobs[lumberjackIndex] <= requiredJobs[quarryWorkerIndex]) {
                            requiredJobs[lumberjackIndex]++;
                            jobAdjustments[lumberjackIndex]++;
                        } else {
                            requiredJobs[quarryWorkerIndex]++;
                            jobAdjustments[quarryWorkerIndex]++;
                        }

                        availableEmployees--;
                    }
                }
            }
        }

        if (settings.autoCraftsmen && state.jobs.SheetMetal.isManaged() && settings['craft' + state.jobs.SheetMetal.resource.id]) {
            if (state.cityBuildings.Wardenclyffe.count < 18) {
                let sheetMetalIndex = jobList.indexOf(state.jobs.SheetMetal);

                if (sheetMetalIndex != -1 && state.cityBuildings.Cottage.count > 10 && state.cityBuildings.Library.count > 15 && state.cityBuildings.CoalMine.count > 8) {
                    let plywoodIndex = jobList.indexOf(state.jobs.Plywood);
                    let brickIndex = jobList.indexOf(state.jobs.Brick);
                    let wroughtIronIndex = jobList.indexOf(state.jobs.WroughtIron);
                    let additionalSheetMetalJobs = 0;
                    
                    if (plywoodIndex !== -1 && state.jobs.Plywood.isManaged()) {
                        // add plywood jobs above 1 to sheet metal
                        let plywoodJobs = requiredJobs[plywoodIndex];

                        if (plywoodJobs > 1) {
                            requiredJobs[plywoodIndex] = 1;
                            jobAdjustments[plywoodIndex] -= (plywoodJobs - 1);
                            additionalSheetMetalJobs += (plywoodJobs - 1);
                        }
                    }

                    if (brickIndex !== -1 && state.jobs.Brick.isManaged()) {
                        // add brick jobs above 1 to sheet metal
                        let brickJobs = requiredJobs[brickIndex];

                        if (brickJobs > 1) {
                            requiredJobs[brickIndex] = 1;
                            jobAdjustments[brickIndex] -= (brickJobs - 1);
                            additionalSheetMetalJobs += (brickJobs - 1);
                        }
                    }

                    if (wroughtIronIndex !== -1 && state.jobs.WroughtIron.isManaged()) {
                        // add wroughtIron jobs above 1 to sheet metal
                        let wroughtIronJobs = requiredJobs[wroughtIronIndex];

                        if (wroughtIronJobs > 1) {
                            requiredJobs[wroughtIronIndex] = 1;
                            jobAdjustments[wroughtIronIndex] -= (wroughtIronJobs - 1);
                            additionalSheetMetalJobs += (wroughtIronJobs - 1);
                        }
                    }

                    requiredJobs[sheetMetalIndex] += additionalSheetMetalJobs;
                    jobAdjustments[sheetMetalIndex] += additionalSheetMetalJobs;
                }
            }
        }

        for (let i = 0; i < jobAdjustments.length; i++) {
            let adjustment = jobAdjustments[i];
            if (adjustment < 0) {
                // I have no clue how this is undefined... but it can be when the script first starts and playing a carnivore / evil race
                // May have fixed it by moving the evil race / hunter race checks to update state in the automate function
                if (jobList[i] !== undefined) {
                    jobList[i].removeWorkers(-1 * adjustment);
                }
                //console.log("Adjusting job " + jobList[i].id + " down by " + adjustment);
            }
        }

        for (let i = 0; i < jobAdjustments.length; i++) {
            let adjustment = jobAdjustments[i];
            if (adjustment > 0) {
                if (jobList[i] !== undefined) {
                    jobList[i].addWorkers(adjustment);
                }
                //console.log("Adjusting job " + jobList[i].id + " up by " + adjustment);
            }
        }
    }

    //#endregion Auto Jobs
    
    //#region Auto Tax

    function autoTax() {
        let currentTaxRateNode = document.querySelector("#tax_rates .current");
        if (currentTaxRateNode === null) return;

        let currentMoraleNode = document.querySelector("#morale");
        if (currentMoraleNode === null) return;

        let raiseTaxNode = document.querySelector("#tax_rates .add");
        let lowerTaxNode = document.querySelector("#tax_rates .sub");

        let currentTaxRate = parseInt(currentTaxRateNode.textContent);
        let currentMorale = parseInt(currentMoraleNode.firstElementChild.textContent);

        let maxMorale = 100 + state.cityBuildings.Amphitheatre.count + state.cityBuildings.Casino.count + (state.projects.Monument.level * 2);
        if (currentTaxRate < 20) {
            maxMorale += 10 - Math.floor(currentTaxRate / 2);
        }

        maxMorale = Math.min(maxMorale, settings.generalMaximumMorale);

        if (currentTaxRate < 50 &&
                ((currentTaxRate < settings.generalMinimumTaxRate && resources.money.storageRatio < 0.98)
                || (currentMorale > 115 && currentMorale >= maxMorale)
                || (currentMorale <= 115 && currentTaxRate < 26))) {
            // @ts-ignore
            raiseTaxNode.click();
        }

        if (currentTaxRate > 0
                && (currentTaxRate > settings.generalMinimumTaxRate || resources.money.storageRatio >= 0.98)
                && (currentMorale < maxMorale - 1 || (currentMorale < 115 && currentTaxRate > 26))) {
            // @ts-ignore
            lowerTaxNode.click();
        }
    }

    //#endregion Auto Tax

    //#region Auto Smelter

    function autoSmelter() {
        // No smelter; no auto smelter. No soup for you.
        if (!state.cityBuildings.Smelter.isUnlocked()) {
            return;
        }

        // We have a smelter but not the technology to smelt steel so there is nothing to automate
        if (!state.cityBuildings.Smelter.isSmeltingUnlocked(SmelterSmeltingTypes.Steel)) {
            return;
        }
        
        // If there is already a modal window open then leave it
        if (state.windowManager.isOpen()) {
            return;
        }

        let smelterOptions = null;

        if (state.cityBuildings.Smelter.isUpdated) {
            // We've already got our cached values so just check if there is any need to change our ratios
            smelterOptions = determineSmelterOptions();

            if (smelterOptions.steelAdjustment >= -1 && smelterOptions.steelAdjustment <= 1) {
                return;
            }
        }

        // Either there is something to adjust or we don't have any cached values. Either way we need to open the window.
        state.cityBuildings.Smelter.openOptions(smelterCallback, smelterOptions);
    }

    function determineSmelterOptions() {
        let smelterIronCount = state.cityBuildings.Smelter.smeltingCount(SmelterSmeltingTypes.Iron);
        let smelterSteelCount = state.cityBuildings.Smelter.smeltingCount(SmelterSmeltingTypes.Steel);

        // The number of buildings hasn't changed so check if we need to adjust. Otherwise continue to updating our numbers
        let maxAllowedSteel = state.cityBuildings.Smelter.count;
        let currentAvaiableRateOfChange = [];
        let steelSmeltingConsumption = state.cityBuildings.Smelter.smeltingConsumption[SmelterSmeltingTypes.Steel];

        // We only care about steel. It isn't worth doing a full generic calculation here
        // Just assume that smelters will always be fueled so Iron smelting is unlimited
        // We want to work out the maximum steel smelters that we can have based on our resource consumption
        for (let i = 0; i < steelSmeltingConsumption.length; i++) {
            let productionCost = steelSmeltingConsumption[i];
            currentAvaiableRateOfChange.push(productionCost.resource.rateOfChange);
        }

        for (let i = 0; i < steelSmeltingConsumption.length; i++) {
            let productionCost = steelSmeltingConsumption[i];
            currentAvaiableRateOfChange[i] += productionCost.quantity * smelterSteelCount;
            let maxAllowedForProductionCost = Math.floor((currentAvaiableRateOfChange[i] - productionCost.minRateOfChange) / productionCost.quantity);
            maxAllowedSteel = Math.min(maxAllowedSteel, maxAllowedForProductionCost);

            if (maxAllowedForProductionCost < maxAllowedSteel) {
                maxAllowedSteel = maxAllowedForProductionCost;
            }
        }

        if (maxAllowedSteel < 0) { maxAllowedSteel = 0; }

        // Now figure out how many steel smelters we want regardless of resource consumption
        let desiredSteelCount = state.cityBuildings.Smelter.count;

        if (state.cityBuildings.Cottage.count < 15) {
            // half to steel with any remainder going to steel
            desiredSteelCount = Math.ceil(state.cityBuildings.Smelter.count / 2);
        } else if (state.cityBuildings.CoalMine.count < 10) {
            // two thirds to steel with any remainder going to steel
            desiredSteelCount = Math.ceil(state.cityBuildings.Smelter.count * 2 / 3);
        } else if (smelterIronCount >= 2) {
            desiredSteelCount = state.cityBuildings.Smelter.count - 2;
        }

        // We'll take the minium of our desired and maximum allowed steel
        if (desiredSteelCount > maxAllowedSteel) { desiredSteelCount = maxAllowedSteel; }
        let adjustmentToSteelCount = desiredSteelCount - smelterSteelCount;

        return { steelAdjustment: adjustmentToSteelCount };
    }

    /**
     * @param {{ steelAdjustment: number; }} smelterOptions
     */
    function smelterCallback(smelterOptions) {
        if (smelterOptions === null || !state.cityBuildings.Smelter.isUpdated) {
            state.cityBuildings.Smelter.updateCachedOptions();
            smelterOptions = determineSmelterOptions();
        }

        // Window is open so perform adjustments if needed
        if (smelterOptions.steelAdjustment > 0) {
            state.cityBuildings.Smelter.increaseSmelting(SmelterSmeltingTypes.Steel, smelterOptions.steelAdjustment);
        }

        if (smelterOptions.steelAdjustment < 0) {
            state.cityBuildings.Smelter.increaseSmelting(SmelterSmeltingTypes.Iron, smelterOptions.steelAdjustment * -1);
        }
    }

    //#endregion Auto Smelter
    
    //#region Auto Factory

    function autoFactory() {
        // No factory; no auto factory
        if (!state.cityBuildings.Factory.isUnlocked()) {
            return;
        }

        // If there is already a modal window open then leave it
        if (state.windowManager.isOpen()) {
            return;
        }

        let factoryOptions = null;

        if (state.cityBuildings.Factory.isUpdated) {
            // We've already got our cached values so just check if there is any need to change our ratios
            factoryOptions = determineFactoryOptions();

            if (factoryOptions.productionChanges.length === 0) {
                return;
            }

            let minChange = 0;
            let maxChange = 0;

            for (let i = 0; i < factoryOptions.productionChanges.length; i++) {
                let productionChange = factoryOptions.productionChanges[i];
                minChange = Math.min(minChange, productionChange.quantity);
                maxChange = Math.max(maxChange, productionChange.quantity);
            }

            // Only bother adjusting if it is more than 1 off, otherise don't open the window
            if (minChange >= -1 && maxChange <= 1) {
                return;
            }
        }

        // Either there is something to adjust or we don't have any cached values. Either way we need to open the window.
        state.cityBuildings.Factory.openOptions(factoryCallback, factoryOptions);
    }

    function determineFactoryOptions() {
        let remainingOperatingFactories = { quantity: state.cityBuildings.Factory.maxOperating, };
        let productionChanges = [];

        // Produce as many nano-tubes as is reasonable, then alloy, then polymer and finally luxury goods
        // Realistically it will only get through to nano tubes and alloy
        updateProductionChange(productionChanges, remainingOperatingFactories, resources.nano_tube, FactoryGoods.NanoTube);
        updateProductionChange(productionChanges, remainingOperatingFactories, resources.alloy, FactoryGoods.Alloy);
        updateProductionChange(productionChanges, remainingOperatingFactories, resources.polymer, FactoryGoods.Polymer);
        updateProductionChange(productionChanges, remainingOperatingFactories, resources.luxury_goods, FactoryGoods.LuxuryGoods);

        return { productionChanges: productionChanges };
    }

    /**
     * @param {{ productionChanges: { factoryGoods: number, quantity: number }[] }} factoryOptions
     */
    function factoryCallback(factoryOptions) {
        if (factoryOptions === null || !state.cityBuildings.Factory.isUpdated) {
            state.cityBuildings.Factory.updateCachedOptions();
            factoryOptions = determineFactoryOptions();
        }

        // Window is open so perform adjustments if needed
        // First decrease any production so that we have room to increase others
        for (let i = 0; i < factoryOptions.productionChanges.length; i++) {
            let productionChange = factoryOptions.productionChanges[i];
            if (productionChange.quantity < 0) { state.cityBuildings.Factory.decreaseProduction(productionChange.factoryGoods, productionChange.quantity * -1) }
        }

        // Increase any production required (if they are 0 then don't do anything with them)
        for (let i = 0; i < factoryOptions.productionChanges.length; i++) {
            let productionChange = factoryOptions.productionChanges[i];
            if (productionChange.quantity > 0) { state.cityBuildings.Factory.increaseProduction(productionChange.factoryGoods, productionChange.quantity) }
        }
    }

    /**
     * @param {{ factoryGoods: number; quantity: number; }[]} productionChanges
     * @param {{ quantity: number; }} remainingOperatingFactories
     * @param {Resource} resource
     * @param {number} factoryGoods
     */
    function updateProductionChange(productionChanges, remainingOperatingFactories, resource, factoryGoods) {
        if (!state.cityBuildings.Factory.isProductionUnlocked(factoryGoods)) {
            return;
        }

        let minimumAllowedProduction = remainingOperatingFactories.quantity; // Can't have more than our total!

        // We're going to check if we are limited by anything that goes into producing the resource.
        // We want to take the highest number we can produce without going over our minimums
        for (let i = 0; i < resource.productionCost.length; i++) {
            let productionCost = resource.productionCost[i];
            let adjustedRateOfChange = productionCost.resource.rateOfChange + (state.cityBuildings.Factory.currentProduction(factoryGoods) * productionCost.quantity);
            let maxForResource = Math.floor((adjustedRateOfChange - productionCost.minRateOfChange) / productionCost.quantity);

            if (maxForResource < 0) { maxForResource = 0; }

            if (maxForResource < minimumAllowedProduction) {
                minimumAllowedProduction = maxForResource;
            }
        }

        if (resource !== resources.nano_tube && resource.storageRatio > 0.98) {
            minimumAllowedProduction = 0;
        }

        if (resource === resources.nano_tube) {
            if (resource.storageRatio === 1) {
                minimumAllowedProduction = 0;
            } else if (resources.neutronium.storageRatio < 0.98) {
                if (state.spaceBuildings.GasSpaceDock.count === 0 && resources.nano_tube.currentQuantity > 250000) {
                    minimumAllowedProduction = 0;
                } else if (!isResearchUnlocked("quantum_computing") && resources.nano_tube.currentQuantity > 100000) { // Research costs 100000
                    minimumAllowedProduction = 0;
                } else if (state.spaceBuildings.GasSpaceDock.count > 0) {
                    let requiredNanoTubes = state.spaceBuildings.GasSpaceDockShipSegment.resourceRequirements.find(resource => resource.resource === resources.nano_tube);

                    if (requiredNanoTubes !== undefined) {
                        if (resources.nano_tube.currentQuantity > requiredNanoTubes.quantity * 1.1) {
                            minimumAllowedProduction = 0;
                        }
                    }
                }
            }
        }
        
        let differenceInProduction = minimumAllowedProduction - state.cityBuildings.Factory.currentProduction(factoryGoods);
        remainingOperatingFactories.quantity -= minimumAllowedProduction;

        if (differenceInProduction !== 0) {
            productionChanges.push( { factoryGoods: factoryGoods, quantity: differenceInProduction } );
        }
    }

    //#endregion Auto Factory
    
    //#region Auto MAD

    function autoMAD() {
        // Don't MAD if it isn't unlocked
        if (!isResearchUnlocked("mad") || document.getElementById("mad").style.display === "none") {
            return;
        }

        if (!resources.population.isUnlocked()) {
            return;
        }
        
        // Can't kill ourselves if we don't have nukes yet...
        let armMissilesBtn = document.querySelector('#mad button.arm');
        if (state.goal !== "PreparingMAD" && armMissilesBtn === null) {
            return;
        }
        
        let launchMissilesBtn = document.querySelector('#mad > div > div:nth-child(3) .button');
        
        if (state.goal !== "PreparingMAD" || (state.goal === "PreparingMAD" && launchMissilesBtn["disabled"])) {
            // @ts-ignore
            armMissilesBtn.click();
            state.goal = "PreparingMAD";
            return; // Give the UI time to update
        }
        
        if (state.warManager.currentSoldiers === state.warManager.maxSoldiers) {
            // Push... the button
            console.log("Soft resetting game with MAD");
            state.goal = "GameOverMan";
            // @ts-ignore
            launchMissilesBtn.click();
        }
    }

    //#endregion Auto MAD

    //#region Auto Seeder Ship

    function autoSeeder() {
        let spaceDock = state.spaceBuildings.GasSpaceDock;

        if (!spaceDock.isUnlocked() || spaceDock.count < 1) {
            return;
        }

        // We want at least 4 probes and a completed ship
        let requiredProbes = spaceDock.Probes.autoMax === Number.MAX_SAFE_INTEGER ? 4 : spaceDock.Probes.autoMax;
        if (spaceDock.lastProbeCount < requiredProbes || spaceDock.lastShipSegmentCount < 100) {
            return;
        }

        // Only one modal window can be open at a time
        // If there is already another modal window open then we can't also open the space dock modal window
        if (state.windowManager.isOpen() && state.windowManager.currentModalWindowTitle !== "Space Dock") {
            return;
        }

        // Let's do this!
        if (!state.windowManager.isOpen()) {
            state.goal = "LaunchingSeeder";
            spaceDock.openOptions();
            return;
        }

        console.log("Soft resetting game with BioSeeder ship");
        spaceDock.tryLaunchShip();
    }

    //#endregion Auto Seeder Ship

    //#region Auto Assemble Gene

    function autoAssembleGene() {
        if (isResearchUnlocked("dna_sequencer")) {
            return;
        }

        let buttons = document.querySelectorAll('#arpaSequence .button');

        if (buttons === null) {
            return;
        }

        for (let i = 0; i < buttons.length; i++) {
            const button = buttons[i];
            if (button.textContent === "Assemble Gene" && resources.knowledge.currentQuantity === resources.knowledge.maxQuantity) {
                // @ts-ignore
                button.click();
            }
        }
    }

    //#endregion Auto Assemble Gene

    //#region Auto Market

    /**
     * @param {boolean} [bulkSell]
     * @param {boolean} [ignoreSellRatio]
     */
    function autoMarket(bulkSell, ignoreSellRatio) {
        adjustTradeRoutes();

        let currentMoney = resources.money.currentQuantity;
        let tradeQuantity = 1000;

        // Market has not been unlocked in game yet (tech not researched)
        if (!state.marketManager.isUnlocked()) {
            return;
        }

        if (state.marketManager.isMultiplierUnlocked(1000) && state.marketManager.getMultiplier() != 1000) {
            state.marketManager.setMultiplier(1000);
            return;
        } else if (!state.marketManager.isMultiplierUnlocked(1000) && state.marketManager.isMultiplierUnlocked(100) && state.marketManager.getMultiplier() != 100) {
            state.marketManager.setMultiplier(100);
            tradeQuantity = 100;
            return;
        }
        
        for (let i = 0; i < state.marketManager.priorityList.length; i++) {
            let resource = state.marketManager.priorityList[i];
            let currentResourceQuantity = resource.currentQuantity;

            if (!resource.isTradable || !resource.isUnlocked() || !state.marketManager.isBuySellUnlocked(resource)) {
                continue;
            }
            
            if (resource.autoSellEnabled === true && (ignoreSellRatio ? true : resource.storageRatio > resource.autoSellRatio)) {
                let sellBtn = $('#market-' + resource.id + ' .order')[1];
                let value = sellBtn.textContent.substr(1);
                let sellValue = getRealNumber(value);
                let counter = 0;

                while(true) {
                    // break if not enough resource or not enough money storage
                    if (currentMoney + sellValue >= resources.money.maxQuantity || currentResourceQuantity - tradeQuantity <= 0 || counter++ > 10) {
                        break;
                    }

                    currentMoney += sellValue;
                    currentResourceQuantity -= tradeQuantity;
                    sellBtn.click();
                }
            }

            if (bulkSell === true) {
                continue;
            }

            if (resource.autoBuyEnabled === true && resource.storageRatio < resource.autoBuyRatio) {
                let buyBtn = $('#market-' + resource.id + ' .order')[0];
                let value = buyBtn.textContent.substr(1);
                let buyValue = getRealNumber(value);
                let counter = 0;

                while(true) {
                    // break if not enough money or not enough resource storage
                    if (currentMoney - buyValue <= state.minimumMoneyAllowed || resource.currentQuantity + tradeQuantity > resource.maxQuantity - 3 * tradeQuantity || counter++ > 2) {
                        break;
                    }

                    currentMoney -= buyValue;
                    currentResourceQuantity += tradeQuantity;
                    buyBtn.click();
                }
            }
        }
    }

    //#endregion Auto Market
    
    //#region Auto Building

    /**
     * @param {Action} building
     * @param {Resource} requiredResource
     * @param {number} requiredProduction
     */
    function buildIfEnoughProduction(building, requiredResource, requiredProduction) {
        if (building.autoBuildEnabled && building.count < building.autoMax && requiredResource.rateOfChange > requiredProduction) {
            building.tryBuild();
            return;
        }
    }
    
    function autoGatherResources() {
        // Don't spam click once we've got a bit of population going
        if (resources.population.currentQuantity > 15) {
            return;
        }
        
        autoGatherResource(state.cityBuildings.Food, 10);
        autoGatherResource(state.cityBuildings.Lumber, 10);
        autoGatherResource(state.cityBuildings.Stone, 10);

        autoGatherResource(state.cityBuildings.Slaughter, 10);
    }
    
    /**
     * @param {Action} gatherable
     * @param {number} nbrOfClicks
     */
    function autoGatherResource(gatherable, nbrOfClicks) {
        if (!gatherable.isUnlocked()) {
            return;
        }

        for (let i = 0; i < nbrOfClicks; i++) {
            gatherable.click();
        }
    }
    
    /**
     * @param {Action} building
     * @param {number} count
     */
    function buildIfCountLessThan(building, count) {
        // If we have less than what we want then try to buy it
        if (building.count < count && building.count < building.autoMax) {
            building.tryBuild();
        }
    }

    function autoBuildSpaceDockChildren() {
        let spaceDock = state.spaceBuildings.GasSpaceDock;

        if (!spaceDock.isUnlocked() || spaceDock.count < 1 || state.goal === "LaunchingSeeder") {
            return;
        }

        // User opened the modal - don't interfere with what they're doing
        if (state.windowManager.isOpen() && !state.windowManager.openedByScript) {
            return;
        }

        // If we're not launching and we've built all we want then don't even check
        if (spaceDock.lastProbeCount >= spaceDock.Probes.autoMax && spaceDock.lastShipSegmentCount >= spaceDock.Ship.autoMax) {
            return;
        }

        // Only one modal window can be open at a time
        // If there is already another modal window open then we can't also open the space dock modal window
        if (state.windowManager.isOpen() && state.windowManager.currentModalWindowTitle !== "Space Dock") {
            return;
        }

        let canBuildShipSegment = true;

        for (let i = 0; i < state.spaceBuildings.GasSpaceDockShipSegment.resourceRequirements.length; i++) {
            const requirement = state.spaceBuildings.GasSpaceDockShipSegment.resourceRequirements[i];
            
            if (requirement.resource.currentQuantity < requirement.quantity) {
                canBuildShipSegment = false;
            }
        }

        // This one involves opening options so don't do it too often
        if (spaceDock.isOptionsUpdated() && !spaceDock.isOptionsOpen() && !canBuildShipSegment && state.loopCounter % 500 !== 0) {
            return;
        }

        // We want to try to build some space dock children... The little rascals!
        // Open the modal in the first loop
        // Try to build and close the modal in the second loop
        if (!state.windowManager.isOpen()) {
            spaceDock.openOptions();
            return;
        }

        // We've opened the options window so lets update where we are currently
        spaceDock.updateOptions();

        if (spaceDock.lastProbeCount < spaceDock.Probes.autoMax) {
            spaceDock.tryBuildProbe();
        }

        // We want to build 100 ship segments max
        if (spaceDock.lastShipSegmentCount < spaceDock.Ship.autoMax) {
            spaceDock.tryBuildShipSegment();
        }

        state.windowManager.closeModalWindow();
    }
    
    function autoBuild() {
        autoGatherResources();

        let buildingList = state.buildingManager.managedPriorityList();

        // No buildings unlocked yet
        if (buildingList.length === 0) {
            return;
        }
        
        let targetBuilding = null;
        let building = null;

        // A bit of trickery early game to get our craftables up. Once we reach 8 amphitheatre's and have < 10 libraries then wait for
        // crafting to catch up again (or less than 10 cottages, or less than 5 coal mines)
        if (state.cityBuildings.Amphitheatre.count > 7  && state.cityBuildings.Amphitheatre.count < 11 && state.jobManager.canManualCraft()) {
            log("autoBuild", "Checking for early game target building");
            building = state.cityBuildings.Library;
            if (building.autoBuildEnabled && building.isUnlocked() && building.autoMax >= 10) {
                if (building.count < 10) {
                    building.tryBuild();
                    log("autoBuild", "Target building: library");
                    targetBuilding = building;
                }
            }

            building = state.cityBuildings.Cottage;
            if (targetBuilding === null && building.autoBuildEnabled && building.isUnlocked() && building.autoMax >= 10 && state.cityBuildings.Smelter.count > 5) {
                if (building.count < 10) {
                    building.tryBuild();
                    log("autoBuild", "Target building: cottage");
                    targetBuilding = building;
               }
            }
            
            building = state.cityBuildings.CoalMine;
            if (targetBuilding === null && building.autoBuildEnabled && building.isUnlocked() && building.autoMax >= 5 && state.cityBuildings.Smelter.count > 5) {
                if (building.count < 5) {
                    building.tryBuild();
                    log("autoBuild", "Target building: coal mine");
                    targetBuilding = building;
               }
            }

            building = state.cityBuildings.StorageYard;
            if (targetBuilding === null && building.autoBuildEnabled && building.isUnlocked() && building.autoMax >= 5 && state.cityBuildings.Smelter.count > 5) {
                if (building.count < 5) {
                    building.tryBuild();
                    log("autoBuild", "Target building: freight yard");
                    targetBuilding = building;
               }
            }
        }

        // Loop through the auto build list and try to buy them
        for(let i = 0; i < buildingList.length; i++) {
            let building = buildingList[i];

            if (!building.autoBuildEnabled) {
                continue;
            }

            // We specifically want to build a target building. Don't build anything else that uses the same resources
            if (targetBuilding !== null) {
                if (targetBuilding.resourceRequirements.some(r => building.resourceRequirements.includes(r))) {
                    log("autoBuild", building.id + " DOES conflict with target building " + targetBuilding.id);
                    continue;
                } else {
                    log("autoBuild", building.id + " DOES NOT conflict with target building " + targetBuilding.id);
                }
            }

            // Only build the following buildings if we have enough production to cover what they use
            if (building === state.cityBuildings.Smelter && getRaceId() !== state.races.Entish.id) {
                buildIfEnoughProduction(building, resources.lumber, 12);
                continue;
            }

            if (building === state.cityBuildings.CoalPower) {
                // I'd like to check if we are in a "no plasmids" run but not sure how... so check manual crafting instead
                if (!isLowPlasmidCount()) {
                    buildIfEnoughProduction(building, resources.coal, 2.35);
                } else {
                    buildIfEnoughProduction(building, resources.coal, 0.5); // If we don't have plasmids then have to go much lower
                }

                continue;
            }

            if (!settings.autoSpace && resources.plasmid.currentQuantity > 2000 && building === state.cityBuildings.OilPower && state.jobManager.canManualCraft()) {
                buildIfCountLessThan(building, 5);
                continue;
            } else if (isLowPlasmidCount() && building === state.cityBuildings.OilPower) {
                buildIfEnoughProduction(building, resources.oil, 1);
                continue;
            } else if (building === state.cityBuildings.OilPower) {
                buildIfEnoughProduction(building, resources.oil, 2.65);
                continue;
            }

            if (building === state.cityBuildings.FissionPower) {
                buildIfEnoughProduction(building, resources.uranium, 0.5);
                continue;
            }

            if (building === state.spaceBuildings.GasSpaceDock) {
                if (building.autoBuildEnabled) {
                    building.tryBuild();
                }

                autoBuildSpaceDockChildren();
                continue;
            }

            if (building === state.spaceBuildings.GasMoonOutpost && building.autoBuildEnabled && building.count >= 2) {
                let eleriumBuilding = state.spaceBuildings.DwarfEleriumContainer;
                if (eleriumBuilding.autoBuildEnabled && eleriumBuilding.autoMax >= 3 && state.spaceBuildings.DwarfEleriumContainer.count < 3) {
                    // Don't build outposts until we have enough elerium storage to do our researches
                    continue;
                }
            }
            
            // Build building if less than our max
            if (building.count < building.autoMax) {
                if (building.tryBuild()) {
                    if (building._tabPrefix === "space") {
                        removePoppers();
                    }
                }
            }
        }
    }

    //#endregion Auto Building

    //#region Auto Research

    function autoResearch() {
        let items = document.querySelectorAll('#tech .action');
        for (let i = 0; i < items.length; i++) {
            if (items[i].className.indexOf("cna") < 0) {
                const itemId = items[i].id;
                let click = false;

                if (itemId !== "tech-anthropology" && itemId !== "tech-fanaticism" && itemId !== "tech-wc_reject"
                    && itemId !== "tech-wc_money" && itemId !== "tech-wc_morale" && itemId !== "tech-wc_conquest"
                    && itemId !== "tech-study" && itemId !== "tech-deify") {
                        click = true;
                } else {
                    if (itemId === settings.userResearchTheology_1) {
                        // use the user's override choice
                        log("autoResearch", "Picking user's choice of theology 1: " + itemId);
                        click = true;
                    }

                    if (settings.userResearchTheology_1 === "auto") {
                        if (!settings.autoSpace && itemId === "tech-anthropology") {
                            // If we're not going to space then research anthropology
                            log("autoResearch", "Picking: " + itemId);
                            click = true;
                        }
                        if (settings.autoSpace && itemId === "tech-fanaticism") {
                            // If we're going to space then research fanatacism
                            log("autoResearch", "Picking: " + itemId);
                            click = true;
                        }
                    }

                    if (itemId === settings.userResearchTheology_2) {
                        // use the user's override choice
                        log("autoResearch", "Picking user's choice of theology 2: " + itemId);
                        click = true;
                    }

                    if (settings.userResearchTheology_2 === "auto") {
                        if (itemId === "tech-deify") {
                            // Just pick deify for now
                            log("autoResearch", "Picking: " + itemId);
                            click = true;
                        }
                    }

                    if (itemId === settings.userResearchUnification) {
                        // use the user's override choice
                        log("autoResearch", "Picking user's choice of unification: " + itemId);
                        click = true;
                    }

                    if (settings.userResearchUnification === "auto") {
                        // Don't reject world unity. We want the +25% resource bonus
                        if (itemId === "tech-wc_money" || itemId === "tech-wc_morale"|| itemId === "tech-wc_conquest") {
                            log("autoResearch", "Picking: " + itemId);
                            click = true;
                        }
                    }
                }

                if (click) {
                    // @ts-ignore
                    items[i].children[0].click();

                    // The unification techs are special as they are always "clickable" even if they can't be afforded.
                    // We don't want to continually remove the poppers if the script is clicking one every second that
                    // it can't afford
                    if (itemId !== "tech-wc_money" && itemId !== "tech-wc_morale" && itemId !== "tech-wc_conquest" && itemId !== "tech-wc_reject") {
                        removePoppers();

                        // Immediately cause a recheck of factory assignment if we've just researched nanotubes
                        if (itemId === "tech-nano_tubes" || itemId === "tech-polymer") {
                            state.cityBuildings.Factory.isUpdated = false;
                        }
                    }
                    return;
                }
            }
        }
    }

    //#endregion Auto Research

    //#region Auto ARPA

    function autoArpa() {
        let projectList = state.projectManager.managedPriorityList();

        // Special autoSpace logic. If autoSpace is on then ignore other ARPA settings and build once MAD has been researched
        if (settings.autoSpace && state.projects.LaunchFacility.isUnlocked() && isResearchUnlocked("mad")) {
            state.projects.LaunchFacility.tryBuild(false);
        }

        // Loop through our managed projects
        for (let i = 0; i < projectList.length; i++) {
            const project = projectList[i];

            // Only level up to user defined max
            if (project.level >= project.autoMax) {
                continue;
            }

            project.tryBuild(true);
        }

        // ONLY IF settings allow then...
        // Loop through our unmanaged projects and build if storage if full for all resources except money
        if (!settings.arpaBuildIfStorageFull) {
            return;
        }

        projectList = state.projectManager.priorityList;

        for (let i = 0; i < projectList.length; i++) {
            const project = projectList[i];
            let allowBuild = true;

            if (project.resourceRequirements.length === 0) {
                continue;
            }

            for (let j = 0; j < project.resourceRequirements.length; j++) {
                const requirement = project.resourceRequirements[j];

                if (requirement.resource === resources.money) {
                    continue;
                }

                if (requirement.resource.currentQuantity < requirement.quantity) {
                    allowBuild = false;
                    break;
                }

                if (!requirement.resource.isCraftable && requirement.resource.storageRatio <= 0.98) {
                    allowBuild = false;
                    break;
                }

                if (requirement.quantity / requirement.resource.currentQuantity > (settings.arpaBuildIfStorageFullResourceMaxPercent / 100)) {
                    allowBuild = false;
                    break;
                }

                if (requirement.resource.isCraftable && requirement.resource.currentQuantity - requirement.quantity < settings.arpaBuildIfStorageFullCraftableMin) {
                    allowBuild = false;
                    break;
                }
            }

            if (allowBuild) {
                project.tryBuild(false);
            }
        }
    }

    //#endregion Auto ARPA
    
    //#region Auto Power

    function autoBuildingPriority() {
        let availablePowerNode = document.querySelector('#powerMeter');
        
        // Only start doing this once power becomes available. Isn't useful before then
        if (availablePowerNode === null) {
            return;
        }

        let buildingList = state.buildingManager.managedStatePriorityList();

        // No buildings unlocked yet
        if (buildingList.length === 0) {
            return;
        }
        
        // Calculate the available power / resource rates of change that we have to work with
        let availablePower = parseInt(availablePowerNode.textContent);
        let spaceFuelMultiplier = 0.95 ** state.cityBuildings.MassDriver.stateOnCount;

        for (let i = 0; i < buildingList.length; i++) {
            let building = buildingList[i];

            availablePower += (building.consumption.power * building.stateOnCount);

            for (let j = 0; j < building.consumption.resourceTypes.length; j++) {
                let resourceType = building.consumption.resourceTypes[j];

                // Mass driver effect
                if (resourceType.resource === resources.oil || resourceType.resource === resources.helium_3) {
                    resourceType.rate = resourceType.initialRate * spaceFuelMultiplier;
                }
                
                // Just like for power, get our total resources available
                resourceType.resource.calculatedRateOfChange += resourceType.rate * building.stateOnCount;
            }
        }

        // Start assigning buildings from the top of our priority list to the bottom
        for (let i = 0; i < buildingList.length; i++) {
            let building = buildingList[i];
            let requiredStateOn = 0;

            for (let j = 0; j < building.count; j++) {
                if (building.consumption.power > 0) {
                    // Building needs power and we don't have any
                    if ((availablePower <= 0 && building.consumption.power > 0) || (availablePower - building.consumption.power < 0)) {
                        continue;
                    }
                }

                if (building === state.spaceBuildings.BeltEleriumShip) {
                    if (resources.elerium.storageRatio >= 0.99 && resources.elerium.rateOfChange >= 0) {
                        if (state.spaceBuildings.DwarfEleriumReactor.autoStateEnabled) {
                            let required = (state.spaceBuildings.DwarfEleriumReactor.count + 1) * 2;
                            if (requiredStateOn >= required) {
                                continue;
                            }
                        }
                    }
                }

                let resourcesToTake = 0;

                for (let k = 0; k < building.consumption.resourceTypes.length; k++) {
                    let resourceType = building.consumption.resourceTypes[k];
                    
                    // TODO: Implement minimum rates of change for each resource
                    // If resource rate is negative then we are gaining resources. So, only check if we are consuming resources
                    // If we have more than 10% of our storage then its ok to lose some resources
                    if (resourceType.rate > 0) {
                        let isStorageAvailable = false;

                        if (resourceType.resource === resources.food) {
                            isStorageAvailable = resourceType.resource.storageRatio > 0.1;
                        }

                        if (!isStorageAvailable) {
                            if (resourceType.resource.calculatedRateOfChange <= 0 || resourceType.resource.calculatedRateOfChange - resourceType.rate < 0) {
                                continue;
                            }
                        }
                    }

                    resourcesToTake++;
                }

                // All resources passed the test so take them.
                if (resourcesToTake === building.consumption.resourceTypes.length) {
                    availablePower -= building.consumption.power;

                    for (let k = 0; k < building.consumption.resourceTypes.length; k++) {
                        let resourceType = building.consumption.resourceTypes[k];
                        resourceType.resource.calculatedRateOfChange -= resourceType.rate;
                    }

                    requiredStateOn++;
                } else {
                    // We couldn't get the resources so skip the rest of this building type
                    break;
                }
            }

            let adjustment = requiredStateOn - building.stateOnCount;

            // If the warning indicator is on then we don't know how many buildings are over-resourced
            // Just take them all off and sort it out next loop
            if (building.isStateOnWarning()) {
                adjustment = -building.stateOnCount;
            }

            if ((adjustment < -1 || adjustment > 1) && (building === state.cityBuildings.Factory || building === state.spaceBuildings.RedFactory)) {
                state.cityBuildings.Factory.isUpdated = false;
            }

            building.tryAdjustState(adjustment);
        }
    }

    //#endregion Auto Power
    
    //#region Auto Trade Specials

    /**
     * @param {{ cratesToBuild: number; containersToBuild: number; availableCrates: number, availableContainers: number, adjustments: any[]; }} storageChanges
     * @param {Resource} resource
     * @param {number} requiredCrates
     * @param {number} requiredContainers
     */
    function addToStorageAdjustments(storageChanges, resource, requiredCrates, requiredContainers) {
        if (resource.assignedCrates !== requiredCrates || resource.assignedContainers !== requiredContainers) {
            let crates = Math.min(requiredCrates - resource.assignedCrates, storageChanges.availableCrates);
            let containers = Math.min(requiredContainers - resource.assignedContainers, storageChanges.availableContainers);

            if (crates !== 0 || containers !== 0) {
                storageChanges.adjustments.push({ resource: resource, cratesAdjustment: crates, containersAdjustment: containers });

                if (crates > 0) storageChanges.availableCrates -= crates;
                if (containers > 0) storageChanges.availableContainers -= containers;

                if (storageChanges.availableCrates < 0) storageChanges.availableCrates = 0;
                if (storageChanges.availableContainers < 0) storageChanges.availableContainers = 0;
            }

            return;
        }
    }

    function autoStorage() {
        let storageList = state.storageManager.managedPriorityList();
        let resourcesToUpdateCachedOptions = null;

        if (storageList.length === 0) {
            return;
        }

        if (state.cityBuildings.StorageYard.count > 0 && state.cityBuildings.Warehouse.count > 0) {
            resourcesToUpdateCachedOptions = storageList.filter(resource => !resource.isAssignedCratesUpdated || !resource.isAssignedContainersUpdated);
        } else if (state.cityBuildings.StorageYard.count > 0) {
            resourcesToUpdateCachedOptions = storageList.filter(resource => !resource.isAssignedCratesUpdated);
        } else if (state.cityBuildings.Warehouse.count > 0) {
            resourcesToUpdateCachedOptions = storageList.filter(resource => !resource.isAssignedContainersUpdated);
        } else {
            // We don't have any storage yet
            return;
        }

        // Update our cached options (crates & containers)
        if (resourcesToUpdateCachedOptions!== null && resourcesToUpdateCachedOptions.length !== 0) {
            state.windowManager.updateResourceCachedOptions(resourcesToUpdateCachedOptions);
            return;
        }

        let numberOfCratesWeCanBuild = 1000000;
        let numberOfContainersWeCanBuild = 1000000;

        resources.crates.resourceRequirements.forEach(requirement =>
            numberOfCratesWeCanBuild = Math.min(numberOfCratesWeCanBuild, requirement.resource.currentQuantity / requirement.quantity)
        );

        resources.containers.resourceRequirements.forEach(requirement =>
            numberOfContainersWeCanBuild = Math.min(numberOfContainersWeCanBuild, requirement.resource.currentQuantity / requirement.quantity)
        );

        let storageChanges = {
            cratesToBuild: Math.min(resources.crates.maxQuantity - resources.crates.currentQuantity, numberOfCratesWeCanBuild),
            containersToBuild: Math.min(resources.containers.maxQuantity - resources.containers.currentQuantity, numberOfContainersWeCanBuild),
            availableCrates: resources.crates.currentQuantity,
            availableContainers: resources.containers.currentQuantity,
            adjustments: []
        };

        let totalCratesWeighting = 0;
        let totalContainersWeighting = 0;
        let totalCrates = resources.crates.currentQuantity;
        let totalContainers = resources.containers.currentQuantity;
        let autoStorageTotalMaxCrates = 0;
        let autoStorageTotalMaxContainers = 0;

        storageList.forEach(resource => {
            if (resource.autoCratesMax < 0 || resource.assignedCrates < resource.autoCratesMax) {
                totalCratesWeighting += resource.autoStorageWeighting;
                totalCrates += resource.assignedCrates;
                autoStorageTotalMaxCrates += resource.autoCratesMax;
            }

            if (resource.autoContainersMax < 0 || resource.assignedContainers < resource.autoContainersMax) {
                totalContainersWeighting += resource.autoStorageWeighting;
                totalContainers += resource.assignedContainers;
                autoStorageTotalMaxContainers += resource.autoContainersMax;
            }
        });

        if (settings.storageLimitPreMad && !isResearchUnlocked("mad")) {
            autoStorageTotalMaxCrates = 0;

            if (isLowPlasmidCount()) {
                // If you don't have many plasmids then you need quite a few crates
                if (resources.steel.isUnlocked()) {
                    addToStorageAdjustments(storageChanges, resources.steel, 50, 0);
                    autoStorageTotalMaxCrates += 50;
                }
            } else {
                if (resources.steel.isUnlocked()) {
                    addToStorageAdjustments(storageChanges, resources.steel, 20, 0);
                    autoStorageTotalMaxCrates += 20;
                }
            }

            if (resources.aluminium.isUnlocked()) {
                addToStorageAdjustments(storageChanges, resources.aluminium, 20, 0);
                autoStorageTotalMaxCrates += 20;
            }
            if (resources.titanium.isUnlocked()) {
                addToStorageAdjustments(storageChanges, resources.titanium, 20, 0);
                autoStorageTotalMaxCrates += 20;
            }
            if (resources.alloy.isUnlocked()) {
                addToStorageAdjustments(storageChanges, resources.alloy, 20, 0);
                autoStorageTotalMaxCrates += 20;
            }
    
            // Polymer required for pre MAD tech is about 800. So just keep adding crates until we have that much storage space
            if (resources.polymer.isUnlocked() && resources.polymer.maxQuantity < 800) {
                addToStorageAdjustments(storageChanges, resources.polymer, resources.polymer.assignedCrates + 1, 0);
                autoStorageTotalMaxCrates += resources.polymer.assignedCrates + 1;
            }

            // We've tinkered with the autoStorageTotalMaxCrates settings in this IF statement so we'll have to do this here
            if (totalCrates > autoStorageTotalMaxCrates) {
                storageChanges.cratesToBuild = 0;
            } else if (totalCrates + storageChanges.cratesToBuild >= autoStorageTotalMaxCrates) {
                storageChanges.cratesToBuild = Math.max(0, autoStorageTotalMaxCrates - totalCrates);
            }

            // Don't open the window every second... wait for a minute if all we're doing is building new crates / containers
            if (state.lastStorageBuildCheckLoop + 60 > state.loopCounter) {
                storageChanges.cratesToBuild = 0;
                storageChanges.containersToBuild = 0;
            }

        } else {
            // Assign crates and containers according to their weighting and accounting for their max settings

            // We'll also have the crates that we build
            if (totalCrates > autoStorageTotalMaxCrates) {
                storageChanges.cratesToBuild = 0;
            } else if (totalCrates + storageChanges.cratesToBuild >= autoStorageTotalMaxCrates) {
                storageChanges.cratesToBuild = Math.max(0, autoStorageTotalMaxCrates - totalCrates);
            }

            // We'll also have the containers that we build
            if (totalContainers > autoStorageTotalMaxContainers) {
                storageChanges.containersToBuild = 0;
            } else if (totalContainers + storageChanges.containersToBuild >= autoStorageTotalMaxContainers) {
                storageChanges.containersToBuild = Math.max(0, autoStorageTotalMaxContainers - totalContainers);
            }

            // Don't open the window every second... wait for a minute if all we're doing is building new crates / containers
            if (state.lastStorageBuildCheckLoop + 60 > state.loopCounter) {
                storageChanges.cratesToBuild = 0;
                storageChanges.containersToBuild = 0;
            }

            totalCrates += storageChanges.cratesToBuild;
            totalContainers += storageChanges.containersToBuild;

            storageList.forEach(resource => {
                let cratesStoragePercentage = resource.autoStorageWeighting / totalCratesWeighting;
                let containersStoragePercentage = resource.autoStorageWeighting / totalContainersWeighting;
                let requiredCrates = 0;
                let requiredContainers = 0;

                if (resource.assignedCrates >= resource.autoCratesMax) {
                    requiredCrates = resource.autoCratesMax;
                } else {
                    requiredCrates = Math.ceil(totalCrates * cratesStoragePercentage);
                }

                // When we very first research MAD we don't want to suddenly reassign the storage that we added before.
                // Leave that as a minimum
                if (settings.storageLimitPreMad) {
                    if (resource === resources.steel) { requiredCrates = Math.max(50, requiredCrates) }
                    if (resource === resources.aluminium) { requiredCrates = Math.max(20, requiredCrates) }
                    if (resource === resources.titanium) { requiredCrates = Math.max(20, requiredCrates) }
                    if (resource === resources.alloy) { requiredCrates = Math.max(20, requiredCrates) }
                    if (resource === resources.polymer) { requiredCrates = Math.max(5, requiredCrates) }
                }

                if (resource.assignedContainers >= resource.autoContainersMax) {
                    requiredContainers = resource.autoContainersMax;
                } else {
                    requiredContainers = Math.ceil(totalContainers * containersStoragePercentage);
                }

                addToStorageAdjustments(storageChanges, resource, requiredCrates, requiredContainers);
            });
        }

        //console.log("To build crates " + storageChanges.cratesToBuild + ", containers " + storageChanges.containersToBuild);
        // for (let i = 0; i < storageChanges.adjustments.length; i++) {
        //     const adjustment = storageChanges.adjustments[i];
        //     console.log(adjustment.resource.id + " crates " + adjustment.cratesAdjustment + ", containers " + adjustment.containersAdjustment);
        // }

        if (storageChanges.cratesToBuild > 0 || storageChanges.containersToBuild > 0 || storageChanges.adjustments.length > 0) {
            if (storageChanges.cratesToBuild > 0 || storageChanges.containersToBuild > 0) {
                state.lastStorageBuildCheckLoop = state.loopCounter;
            }

            //console.log(storageChanges.adjustments.length + ", resource " + storageChanges.adjustments[0].resource.id + ", adjustment " + storageChanges.adjustments[0].cratesAdjustment)
            state.windowManager.updateStorage(storageChanges);
        }
    }

    /**
     * @param {any[] | { resource: any; requiredTradeRoutes: any; completed: boolean; index: number; }[]} requiredTradeRouteResources
     * @param {Resource[]} marketResources
     * @param {Resource} resource
     */
    function addResourceToTrade(requiredTradeRouteResources, marketResources, resource) {
        if (!resource.autoTradeBuyEnabled || resource.autoTradeBuyRoutes <= 0) {
            return;
        }

        requiredTradeRouteResources.push( {
            resource: resource,
            requiredTradeRoutes: resource.autoTradeBuyRoutes,
            completed: false,
            index: findArrayIndex(marketResources, "id", resource.id),
        } );
    }
    
    function adjustTradeRoutes() {
        let m = state.marketManager;
        let tradableResources = m.getSortedTradeRouteSellList();
        let maxTradeRoutes = m.getMaxTradeRoutes();
        let tradeRoutesUsed = 0;
        let currentMoneyPerSecond = resources.money.rateOfChange;
        let requiredTradeRoutes = [];
        let adjustmentTradeRoutes = [];
        let resourcesToTrade = [];

        // Calculate the resources and money that we would have if we weren't trading anything on the market
        for (let i = 0; i < tradableResources.length; i++) {
            const resource = tradableResources[i];

            if (resource.currentTradeRoutes > 0) {
                currentMoneyPerSecond += resource.currentTradeRoutes * resource.currentTradeRouteBuyPrice;
            } else {
                currentMoneyPerSecond += resource.currentTradeRoutes * resource.currentTradeRouteSellPrice;
            }

            resource.calculatedRateOfChange -= resource.currentTradeRoutes * resource.tradeRouteQuantity;
        }

        // Fill our trade routes with selling
        for (let i = 0; i < tradableResources.length; i++) {
            const resource = tradableResources[i];
            requiredTradeRoutes.push(0);

            while (resource.autoTradeSellEnabled && tradeRoutesUsed < maxTradeRoutes && resource.storageRatio > 0.98 && resource.calculatedRateOfChange > resource.autoTradeSellMinPerSecond) {
                tradeRoutesUsed++;
                requiredTradeRoutes[i]--;
                resource.calculatedRateOfChange -= resource.tradeRouteQuantity;
                currentMoneyPerSecond += resource.currentTradeRouteSellPrice;
            }

            //console.log(resource.id + " tradeRoutesUsed " + tradeRoutesUsed + ", maxTradeRoutes " + maxTradeRoutes + ", storageRatio " + resource.storageRatio + ", calculatedRateOfChange " + resource.calculatedRateOfChange)
            if (resource.autoTradeBuyEnabled && resource.autoTradeBuyRoutes > 0) {
                addResourceToTrade(resourcesToTrade, tradableResources, resource);
            }
        }

        //console.log("current money per second: " + currentMoneyPerSecond);

        while (findArrayIndex(resourcesToTrade, "completed", false) != -1) {
            for (let i = 0; i < resourcesToTrade.length; i++) {
                const resourceToTrade = resourcesToTrade[i];
                //console.log(state.loopCounter + " " + resourceToTrade.resource.id + " testing...")

                // The resources is not currenlty unlocked or we've done all we can or we already have max storage so don't trade for more of it
                if (resourceToTrade.index === -1 || resourceToTrade.completed || resourceToTrade.resource.storageRatio > 0.98) {
                    //console.log(state.loopCounter + " " + resourceToTrade.resource.id + " completed 1 - " + resourceToTrade.index)
                    resourceToTrade.completed = true;
                    continue;
                }

                // If we have free trade routes and we want to trade for more resources and we can afford it then just do it
                if (!resourceToTrade.completed
                            && tradeRoutesUsed < maxTradeRoutes
                            && resourceToTrade.requiredTradeRoutes > requiredTradeRoutes[resourceToTrade.index]
                            && currentMoneyPerSecond - resourceToTrade.resource.currentTradeRouteBuyPrice > settings.tradeRouteMinimumMoneyPerSecond) {
                    currentMoneyPerSecond -= resourceToTrade.resource.currentTradeRouteBuyPrice;
                    tradeRoutesUsed++;
                    requiredTradeRoutes[resourceToTrade.index]++;
                    //console.log(state.loopCounter + " " + resourceToTrade.resource.id + " adding trade route - " + resourceToTrade.index)
                    continue;
                }

                // We're buying enough resources now or we don't have enough money to buy more anyway
                if (resourceToTrade.requiredTradeRoutes === requiredTradeRoutes[resourceToTrade.index]
                            || currentMoneyPerSecond - resourceToTrade.resource.currentTradeRouteBuyPrice < settings.tradeRouteMinimumMoneyPerSecond) {
                    //console.log(state.loopCounter + " " + resourceToTrade.resource.id + " completed 2")
                    resourceToTrade.completed = true;
                    continue;
                }

                // We're out of trade routes because we're selling so much. Remove them one by one until we can afford to buy again
                if (resourceToTrade.requiredTradeRoutes > requiredTradeRoutes[resourceToTrade.index]) {
                    let addedTradeRoute = false;

                    for (let i = tradableResources.length - 1; i >= 0; i--) {
                        if (addedTradeRoute) {
                            break;
                        }

                        const resource = tradableResources[i];
                        let currentRequired = requiredTradeRoutes[i];
                        let reducedMoneyPerSecond = 0;

                        // We can't remove it if we're not selling it or if we are looking at the same resource
                        if (currentRequired >= 0 || resourceToTrade.resource === resource) {
                            continue;
                        }
                        
                        while (currentRequired < 0 && resourceToTrade.requiredTradeRoutes > requiredTradeRoutes[resourceToTrade.index]) {
                            currentRequired++;
                            reducedMoneyPerSecond += resource.currentTradeRouteSellPrice;

                            if (currentMoneyPerSecond - reducedMoneyPerSecond - resourceToTrade.resource.currentTradeRouteBuyPrice > settings.tradeRouteMinimumMoneyPerSecond) {
                                currentMoneyPerSecond -= reducedMoneyPerSecond;
                                currentMoneyPerSecond -= resourceToTrade.resource.currentTradeRouteBuyPrice;
                                //console.log(state.loopCounter + " " + resourceToTrade.resource.id + " current money per second: " + currentMoneyPerSecond);
                                requiredTradeRoutes[resourceToTrade.index]++;
                                requiredTradeRoutes[i] = currentRequired;
                                addedTradeRoute = true;

                                if (requiredTradeRoutes[resourceToTrade.index] === resourceToTrade.requiredTradeRoutes) {
                                    //console.log(state.loopCounter + " " + resourceToTrade.resource.id + " completed 3")
                                    resourceToTrade.completed = true;
                                }
                                break;
                            }
                        }
                    }

                    // We couldn't adjust enough trades to allow us to afford this resource
                    if (!addedTradeRoute) {
                        //console.log(state.loopCounter + " " + resourceToTrade.resource.id + " completed 4")
                        resourceToTrade.completed = true;
                    }
                }
            }
        }

        // Calculate adjustments
        for (let i = 0; i < tradableResources.length; i++) {
            adjustmentTradeRoutes.push(requiredTradeRoutes[i] - tradableResources[i].currentTradeRoutes);
        }

        // Adjust our trade routes - always adjust towards zero first to free up trade routes
        for (let i = 0; i < tradableResources.length; i++) {
            const resource = tradableResources[i];

            if (adjustmentTradeRoutes[i] > 0 && resource.currentTradeRoutes < 0) {
                m.addTradeRoutes(resource, adjustmentTradeRoutes[i]);
                adjustmentTradeRoutes[i] = 0;
            } else if (adjustmentTradeRoutes[i] < 0 && resource.currentTradeRoutes > 0) {
                m.removeTradeRoutes(resource, -1 * adjustmentTradeRoutes[i]);
                adjustmentTradeRoutes[i] = 0;
            }
        }

        // Adjust our trade routes - we've adjusted towards zero, now adjust the rest
        for (let i = 0; i < tradableResources.length; i++) {
            const resource = tradableResources[i];

            if (adjustmentTradeRoutes[i] > 0) {
                m.addTradeRoutes(resource, adjustmentTradeRoutes[i]);
            } else if (adjustmentTradeRoutes[i] < 0) {
                m.removeTradeRoutes(resource, -1 * adjustmentTradeRoutes[i]);
            }
        }
    }

    //#endregion Auto Trade Specials
    
    //#region Main Loop

    function updateState() {
        if ($('#evolution') !== null && ($('#evolution')[0].style.display !== 'none') || $('#topBar > span')[0].textContent === "Prehistoric") {
            state.goal = "Evolution";
        } else if (state.goal === "Evolution") {
            state.goal = "Standard";
        }

        if (settings.minimumMoneyPercentage > 0) {
            state.minimumMoneyAllowed = resources.money.maxQuantity * settings.minimumMoneyPercentage / 100;
        } else {
            state.minimumMoneyAllowed = settings.minimumMoney;
        }

        // If our script opened a modal window but it is now closed (and the script didn't close it) then the user did so don't continue
        // with whatever our script was doing with the open modal window.
        if (state.windowManager.openedByScript && !state.windowManager.isOpenHtml()) {
            state.windowManager.resetWindowManager();
        }

        state.buildingManager.updateResourceRequirements();
        state.projectManager.updateResourceRequirements();

        // This would be better done in the class itself
        if (document.querySelector("#tech-breeder_reactor .oldTech") === null) {
            state.cityBuildings.FissionPower.consumption.power = -14;
        } else {
            state.cityBuildings.FissionPower.consumption.power = -18;
        }

        if (isLumberRace()) {
            resources.crates.resourceRequirements[0].resource = resources.plywood;
            resources.crates.resourceRequirements[0].quantity = 10;
        } else {
            resources.crates.resourceRequirements[0].resource = resources.stone;
            resources.crates.resourceRequirements[0].quantity = 200;
        }

        if (isEvilRace()) {
            if (state.jobs.Lumberjack.id === "lumberjack") {
                state.jobs.Lumberjack.updateId("Hunter", "free");
            }

            if (resources.food.name === "Food") {
                state.windowManager.updateGeneralCallback(resources.food.name, "Souls");
                resources.food.name = "Souls";
                state.windowManager.updateGeneralCallback(resources.lumber.name, "Bones");
                resources.lumber.name = "Bones";
                state.windowManager.updateGeneralCallback(resources.furs.name, "Flesh");
                resources.furs.name = "Flesh";
                state.windowManager.updateGeneralCallback(resources.plywood.name, "Boneweave");
                resources.plywood.name = "Boneweave";
            }
        }

        if (isHunterRace()) {
            if (state.jobs.Farmer.id === "farmer") {
                state.jobs.Farmer.updateId("Hunter", "free");
            }
        }
    }

    function automate() {
        updateState();
        updateUI();

        if (modifierKeyPressed) {
            return;
        }
        
        if (state.goal === "Evolution") {
            if (settings.autoEvolution) {
                autoEvolution();
            }
        } else if (state.goal !== "GameOverMan") {
            // Initial updates needed each loop
            for (let i = 0; i < state.allResourceList.length; i++) {
                state.allResourceList[i].calculatedRateOfChange = state.allResourceList[i].rateOfChange;
            }

            if (settings.autoFight) {
                autoBattle();
            }
            if (settings.autoARPA) {
                autoArpa();
            }
            if (settings.autoBuild) {
                autoBuild();
            }
            if (settings.autoCraft) {
                autoCraft();
            }
            if (settings.autoResearch) {
                autoResearch();
            }
            if (settings.autoMarket) {
                autoMarket();
            }
            if (settings.autoStorage) {
                autoStorage();
            }
            if (settings.autoJobs) {
                autoJobs();
            }
            if (settings.autoTax) {
                autoTax();
            }
            if (settings.autoPower) {
                autoBuildingPriority();
            }
            if (settings.autoFactory) {
                autoFactory();
            }
            if (settings.autoSmelter) {
                autoSmelter();
            }
            if (settings.autoMAD) {
                autoMAD();
            }
            if (settings.autoSeeder) {
                autoSeeder();
            }
            if (settings.autoAssembleGene) {
                autoAssembleGene();
            }
        }
        
        if (state.loopCounter <= 1000000000) {
            state.loopCounter++;
        } else {
            state.loopCounter = 1;
        }
    }

    setInterval(automate, 1000);

    function shortLoop() {
        state.windowManager.checkCallbacks();
    }

    setInterval(shortLoop, 50);

    //#endregion Main Loop

    //#region UI

    addScriptStyle();

    function addScriptStyle() {
        let styles = `
            .scriptlastcolumn:after { float: right; content: "\\21c5"; }
            .ui-sortable-helper { display: table; }
            .scriptdraggable { cursor: move; cursor: grab; }
            tr:active, tr.ui-sortable-helper { cursor: grabbing !important; }

            .scriptcollapsible {
                background-color: #444;
                color: white;
                cursor: pointer;
                padding: 18px;
                width: 100%;
                border: none;
                text-align: left;
                outline: none;
                font-size: 15px;
            }
            
            .scriptcontentactive, .scriptcollapsible:hover {
                background-color: #333;
            }
            
            .scriptcollapsible:after {
                content: '\\002B';
                color: white;
                font-weight: bold;
                float: right;
                margin-left: 5px;
            }
            
            .scriptcontentactive:after {
                content: "\\2212";
            }
            
            .scriptcontent {
                padding: 0 18px;
                display: none;
                //max-height: 0;
                overflow: hidden;
                //transition: max-height 0.2s ease-out;
                //background-color: #f1f1f1;
            }
            
            .scriptsearchsettings {
                width: 100%;
                margin-top: 20px;
                margin-bottom: 10px;
            }
        `

        // Create style document
        var css = document.createElement('style');
        css.type = 'text/css';
        css.appendChild(document.createTextNode(styles));
        
        // Append style to html head
        document.getElementsByTagName("head")[0].appendChild(css);
    }

    const loadJQueryUI = (callback) => {
        const existingScript = document.getElementById('script_jqueryui');
      
        if (!existingScript) {
          const script = document.createElement('script');
          script.src = 'https://code.jquery.com/ui/1.12.1/jquery-ui.min.js'
          script.id = 'script_jqueryui'; // e.g., googleMaps or stripe
          document.body.appendChild(script);
      
          script.onload = () => {
            if (callback) callback();
          };
        }
      
        if (existingScript && callback) callback();
      };

    function createScriptSettings() {
        loadJQueryUI(() => {
            // Work to do after the library loads.
            buildScriptSettings();
          });  
    }

    function buildScriptSettings() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let scriptContentNode = $('<div id="script_settings" style="margin-top: 30px;"></div>');
        $("#settings").append(scriptContentNode);

        buildImportExport();
        buildGeneralSettings();
        buildEvolutionSettings();
        buildResearchSettings();
        buildWarSettings();
        buildMarketSettings();
        buildStorageSettings();
        buildJobSettings();
        buildBuildingSettings();
        buildProjectSettings();

        let collapsibles = document.getElementsByClassName("scriptcollapsible");
        for (let i = 0; i < collapsibles.length; i++) {
            collapsibles[i].addEventListener("click", function() {
                this.classList.toggle("scriptcontentactive");
                let content = this.nextElementSibling;
                if (content.style.display === "block") {
                    settings[collapsibles[i].id] = true; 
                    content.style.display = "none";

                    let search = content.getElementsByClassName("scriptsearchsettings");
                    if (search.length > 0) {
                        search[0].value = "";
                        filterBuildingSettingsTable();
                    }
                } else {
                    settings[collapsibles[i].id] = false;
                    content.style.display = "block";
                    content.style.height = content.offsetHeight + "px";
                }

                updateSettingsFromState();
            });
        }

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildImportExport() {
        let importExportNode = $('#settings .importExport');
        if (importExportNode === null) {
            return;
        }

        importExportNode.append(' <button id="script_settingsImport" class="button">Import Script Settings</button>');

        $('#script_settingsImport').on("click", function() {
            if ($('#importExport').val().length > 0) {
                //let saveState = JSON.parse(LZString.decompressFromBase64($('#importExport').val()));
                let saveState = JSON.parse($('#importExport').val());
                if (saveState && 'scriptName' in saveState && saveState.scriptName === "TMVictor") {
                    settings = saveState;
                    updateStateFromSettings();
                    updateSettingsUI();
                    $('#importExport').val("");
                }
            }
        });

        importExportNode.append(' <button id="script_settingsExport" class="button">Export Script Settings</button>');

        $('#script_settingsExport').on("click", function() {
            //$('#importExport').val(LZString.compressToBase64(JSON.stringify(global)));
            $('#importExport').val(JSON.stringify(settings));
            $('#importExport').select();
            document.execCommand('copy');
        });
    }

    function updateSettingsUI() {
        updateGeneralSettingsContent();
        updateEvolutionSettingsContent();
        updateResearchSettingsContent();
        updateWarSettingsContent();
        updateMarketSettingsContent();
        updateStorageSettingsContent();
        updateJobSettingsContent();
        updateBuildingSettingsContent();
        updateProjectSettingsContent();
    }

    function buildSettingsSection(sectionId, sectionName, resetFunction, updateSettingsContentFunction) {
        let scriptContentNode = $("#script_settings");

        scriptContentNode.append(
            '<div id="script_' + sectionId + 'Settings" style="margin-top: 10px;">' +
                '<h3 id="' + sectionId + 'SettingsCollapsed" class="scriptcollapsible text-center has-text-success">' + sectionName + ' Settings</h3>' +
                '<div class="scriptcontent">' +
                    '<div style="margin-top: 10px;"><button id="script_reset' + sectionId + '" class="button">Reset ' + sectionName + ' Settings</button></div>' +
                    '<div style="margin-top: 10px; margin-bottom: 10px;" id="script_' + sectionId + 'Content"></div>' +
                '</div>' +
            '</div>');

        updateSettingsContentFunction();

        if (!settings[sectionId + "SettingsCollapsed"]) {
            let element = document.getElementById(sectionId + "SettingsCollapsed");
            element.classList.toggle("scriptcontentactive");
            let content = element.nextElementSibling;
            //@ts-ignore
            content.style.display = "block";
        }

        $("#script_reset" + sectionId).on("click", resetFunction);
    }

    /**
     * @param {{ append: (arg0: string) => void; }} node
     * @param {string} settingName
     * @param {string} labelText
     * @param {string} hintText
     */
    function addStandardSectionSettingsToggle(node, settingName, labelText, hintText) {
        node.append('<div style="margin-top: 5px; width: 500px; display: inline-block;"><label title="' + hintText + '" tabindex="0" class="switch" id="script_' + settingName + '"><input type="checkbox" value=false> <span class="check"></span><span style="margin-left: 10px;">' + labelText + '</span></label></div>')

        let toggleNode = $('#script_' + settingName + ' > input');
        if (settings[settingName]) {
            toggleNode.prop('checked', true);
        }
    
        toggleNode.on('change', function(e) {
            settings[settingName] = e.currentTarget.checked;
            updateSettingsFromState();
        });
    }

    /**
     * @param {{ append: (arg0: string) => void; }} node
     * @param {string} settingName
     * @param {string} labelText
     * @param {string} hintText
     */
    function addStandardSectionSettingsNumber(node, settingName, labelText, hintText) {
        node.append('<div style="margin-top: 5px; width: 500px; display: inline-block;"><label title="' + hintText + '" for="script_' + settingName + '">' + labelText + '</label><input id="script_' + settingName + '" type="text" class="input is-small" style="width: 150px; float: right;"></input></div>');

        let textBox = $('#script_' + settingName);
        textBox.val(settings[settingName]);
    
        textBox.on('change', function() {
            let parsedValue = getRealNumber(textBox.val());
            if (!isNaN(parsedValue)) {
                settings[settingName] = parsedValue;
                updateSettingsFromState();
            }
        });
    }

    function buildGeneralSettings() {
        let sectionId = "general";
        let sectionName = "General";

        let resetFunction = function() {
            //resetGeneralState();
            resetGeneralSettings();
            updateSettingsFromState();
            updateGeneralSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateGeneralSettingsContent);
    }

    function updateGeneralSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_generalContent');
        currentNode.empty().off("*");

        updateGeneralPreTable();

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function updateGeneralPreTable() {
        let currentNode = $('#script_generalContent');

        // Add the pre table section
        currentNode.append('<div style="margin-top: 10px; margin-bottom: 10px;" id="script_generalPreTable"></div>');

        // Add any pre table settings
        let preTableNode = $('#script_generalPreTable');
        addStandardSectionSettingsNumber(preTableNode, "generalMinimumTaxRate", "Minimum allowed tax rate", "Minimum tax rate for autoTax. Will still go below this amount if money storage is full");
        addStandardSectionSettingsNumber(preTableNode, "generalMaximumMorale", "Maximum allowed morale", "Use this to set a maximum allowed morale. The tax rate will be raised to lower morale to this maximum");
    }

    function buildEvolutionSettings() {
        let sectionId = "evolution";
        let sectionName = "Evolution";

        let resetFunction = function() {
            resetEvolutionSettings();
            updateSettingsFromState();
            updateEvolutionSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateEvolutionSettingsContent);
    }

    function updateEvolutionSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_evolutionContent');
        currentNode.empty().off("*");

        let targetEvolutionNode = $('<div style="margin-top: 5px; width: 400px;"><label for="script_userEvolutionTargetName">Target Evolution:</label><select id="script_userEvolutionTargetName" style="width: 150px; float: right;"></select></div><div><span id="script_race_warning" class="has-text-danger"></span></div>');
        currentNode.append(targetEvolutionNode);

        let selectNode = $('#script_userEvolutionTargetName');

        let selected = settings.userEvolutionTargetName === "auto" ? ' selected="selected"' : "";
        let node = $('<option value = "auto"' + selected + '>Script Managed</option>');
        selectNode.append(node);

        for (let i = 0; i < state.raceAchievementList.length; i++) {
            const race = state.raceAchievementList[i];
            let selected = settings.userEvolutionTargetName === race.name ? ' selected="selected"' : "";

            let raceNode = $('<option value = "' + race.name + '"' + selected + '>' + race.name + '</option>');
            selectNode.append(raceNode);
        }

        let race = state.raceAchievementList[findArrayIndex(state.raceAchievementList, "name", settings.userEvolutionTargetName)];
        if (race !== null && race !== undefined && race.isEvolutionConditional) {
            document.getElementById("script_race_warning").textContent = "Warning! Only choose if you meet requirements: " + race.evolutionConditionText;
        }

        selectNode.on('change', function() {
            let value = $("#script_userEvolutionTargetName :selected").val();
            settings.userEvolutionTargetName = value;
            updateSettingsFromState();
            //console.log("Chosen evolution target of " + value);
            
            let race = state.raceAchievementList[findArrayIndex(state.raceAchievementList, "name", settings.userEvolutionTargetName)];
            if (race !== null && race !== undefined && race.isEvolutionConditional) {
                document.getElementById("script_race_warning").textContent = "Warning! Only choose if you meet requirements: " + race.evolutionConditionText;
            } else {
                document.getElementById("script_race_warning").textContent = "";
            }

            let content = document.querySelector('#script_evolutionSettings .scriptcontent');
            // @ts-ignore
            content.style.height = null;
            // @ts-ignore
            content.style.height = content.offsetHeight + "px"
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildResearchSettings() {
        let sectionId = "research";
        let sectionName = "Research";

        let resetFunction = function() {
            resetResearchSettings();
            updateSettingsFromState();
            updateResearchSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateResearchSettingsContent);
    }

    function updateResearchSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_researchContent');
        currentNode.empty().off("*");

        // Theology 1
        let theology1Node = $('<div style="margin-top: 5px; width: 400px"><label for="script_userResearchTheology_1">Target Theology 1:</label><select id="script_userResearchTheology_1" style="width: 150px; float: right;"></select></div>');
        currentNode.append(theology1Node);

        let selectNode = $('#script_userResearchTheology_1');
        let selected = settings.userResearchTheology_1 === "auto" ? ' selected="selected"' : "";
        let optionNode = $('<option value = "auto"' + selected + '>Script Managed</option>');
        selectNode.append(optionNode);

        selected = settings.userResearchTheology_1 === "tech-anthropology" ? ' selected="selected"' : "";
        optionNode = $('<option value = "tech-anthropology"' + selected + '>Anthropology</option>');
        selectNode.append(optionNode);

        selected = settings.userResearchTheology_1 === "tech-fanaticism" ? ' selected="selected"' : "";
        optionNode = $('<option value = "tech-fanaticism"' + selected + '>Fanaticism</option>');
        selectNode.append(optionNode);

        selectNode.on('change', function() {
            let value = $("#script_userResearchTheology_1 :selected").val();
            settings.userResearchTheology_1 = value;
            updateSettingsFromState();
            //console.log("Chosen theology 1 target of " + value);
        });

        // Theology 2
        let theology2Node = $('<div style="margin-top: 5px; width: 400px"><label for="script_userResearchTheology_2">Target Theology 2:</label><select id="script_userResearchTheology_2" style="width: 150px; float: right;"></select></div>');
        currentNode.append(theology2Node);

        selectNode = $('#script_userResearchTheology_2');
        selected = settings.userResearchTheology_2 === "auto" ? ' selected="selected"' : "";
        optionNode = $('<option value = "auto"' + selected + '>Script Managed</option>');
        selectNode.append(optionNode);

        selected = settings.userResearchTheology_2 === "tech-study" ? ' selected="selected"' : "";
        optionNode = $('<option value = "tech-study"' + selected + '>Study</option>');
        selectNode.append(optionNode);

        selected = settings.userResearchTheology_2 === "tech-deify" ? ' selected="selected"' : "";
        optionNode = $('<option value = "tech-deify"' + selected + '>Deify</option>');
        selectNode.append(optionNode);

        selectNode.on('change', function() {
            let value = $("#script_userResearchTheology_2 :selected").val();
            settings.userResearchTheology_2 = value;
            updateSettingsFromState();
            //console.log("Chosen theology 2 target of " + value);
        });

        // Unification
        let unificationNode = $('<div style="margin-top: 5px; width: 400px"><label for="script_userResearchUnification">Target Unification:</label><select id="script_userResearchUnification" style="width: 150px; float: right;"></select></div>');
        currentNode.append(unificationNode);

        selectNode = $('#script_userResearchUnification');
        selected = settings.userResearchUnification === "auto" ? ' selected="selected"' : "";
        optionNode = $('<option value = "auto"' + selected + '>Script Managed</option>');
        selectNode.append(optionNode);

        selected = settings.userResearchUnification === "tech-wc_reject" ? ' selected="selected"' : "";
        optionNode = $('<option value = "tech-wc_reject"' + selected + '>Reject</option>');
        selectNode.append(optionNode);

        selected = settings.userResearchUnification === "tech-wc_money" ? ' selected="selected"' : "";
        optionNode = $('<option value = "tech-wc_money"' + selected + '>Money</option>');
        selectNode.append(optionNode);

        selected = settings.userResearchUnification === "tech-wc_morale" ? ' selected="selected"' : "";
        optionNode = $('<option value = "tech-wc_morale"' + selected + '>Morale</option>');
        selectNode.append(optionNode);

        selected = settings.userResearchUnification === "tech-wc_conquest" ? ' selected="selected"' : "";
        optionNode = $('<option value = "tech-wc_conquest"' + selected + '>Conquest</option>');
        selectNode.append(optionNode);

        selectNode.on('change', function() {
            let value = $("#script_userResearchUnification :selected").val();
            settings.userResearchUnification = value;
            updateSettingsFromState();
            //console.log("Chosen unification target of " + value);
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildWarSettings() {
        let sectionId = "war";
        let sectionName = "War";

        let resetFunction = function() {
            resetWarState();
            updateSettingsFromState();
            updateWarSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateWarSettingsContent);
    }

    function updateWarSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_warContent');
        currentNode.empty().off("*");

        currentNode.append(
            `<table style="width:100%"><tr><th class="has-text-warning" style="width:25%">Campaign</th><th class="has-text-warning" style="width:25%">Minimum Attack Rating</th><th class="has-text-warning" style="width:50%"></th></tr>
                <tbody id="script_warTableBody" class="scriptcontenttbody"></tbody>
            </table>`);
        
        let warTableBody = $('#script_warTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < state.warManager.campaignList.length; i++) {
            const campaign = state.warManager.campaignList[i];
            newTableBodyText += '<tr value="' + campaign.id + '"><td id="script_' + campaign.id + 'Toggle" style="width:25%"></td><td style="width:25%"></td><td style="width:50%"></td></tr>';
        }
        warTableBody.append($(newTableBodyText));

        // Build campaign settings rows
        for (let i = 0; i < state.warManager.campaignList.length; i++) {
            const campaign = state.warManager.campaignList[i];
            let warElement = $('#script_' + campaign.id + 'Toggle');

            let toggle = $('<span class="has-text-info" style="margin-left: 20px;">' + campaign.name + '</span>');
            warElement.append(toggle);

            warElement = warElement.next();
            warElement.append(buildCampaignRatingSettingsInput(campaign));
        }

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    /**
     * @param {Campaign} campaign
     */
    function buildCampaignRatingSettingsInput(campaign) {
        let campaignMaxTextBox = $('<input type="text" class="input is-small" style="width:25%"/>');
        campaignMaxTextBox.val(settings["btl_" + campaign.id]);
    
        campaignMaxTextBox.on('change', function() {
            let val = campaignMaxTextBox.val();
            let rating = getRealNumber(val);
            if (!isNaN(rating)) {
                //console.log('Setting max for war ' + war.name + ' to be ' + max);
                campaign.rating = rating;
                updateSettingsFromState();
            }
        });

        return campaignMaxTextBox;
    }

    function buildMarketSettings() {
        let sectionId = "market";
        let sectionName = "Market";

        let resetFunction = function() {
            resetMarketState();
            resetMarketSettings();
            updateSettingsFromState();
            updateMarketSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateMarketSettingsContent);
    }

    function updateMarketSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_marketContent');
        currentNode.empty().off("*");

        updateMarketPreTable();
        updateMarketTable();

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function updateMarketPreTable() {
        let currentNode = $('#script_marketContent');

        // Add the pre table section
        currentNode.append('<div style="margin-top: 10px; margin-bottom: 10px;" id="script_marketPreTable"></div>');

        // Add any pre table settings
        let preTableNode = $('#script_marketPreTable');
        addStandardSectionSettingsNumber(preTableNode, "tradeRouteMinimumMoneyPerSecond", "Trade minimum money /s", "Will trade for resources until this minimum money per second amount is hit");
    }

    function updateMarketTable() {
        let currentNode = $('#script_marketContent');
        currentNode.append(
            `<table style="width:100%"><tr><th class="has-text-warning" style="width:15%">Resource</th><th class="has-text-warning" style="width:10%">Buy</th><th class="has-text-warning" style="width:10%">Ratio</th><th class="has-text-warning" style="width:10%">Sell</th><th class="has-text-warning" style="width:10%">Ratio</th><th class="has-text-warning" style="width:10%">Trade For</th><th class="has-text-warning" style="width:10%">Routes</th><th class="has-text-warning" style="width:10%">Trade Away</th><th class="has-text-warning" style="width:10%">Min p/s</th><th style="width:5%"></th></tr>
                <tbody id="script_marketTableBody" class="scriptcontenttbody"></tbody>
            </table>`
        );

        let tableBodyNode = $('#script_marketTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < state.marketManager.priorityList.length; i++) {
            const resource = state.marketManager.priorityList[i];
            let classAttribute = ' class="scriptdraggable"';
            newTableBodyText += '<tr value="' + resource.id + '"' + classAttribute + '><td id="script_market_' + resource.id + 'Toggle" style="width:15%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:5%"></td></tr>';
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other markets settings rows
        for (let i = 0; i < state.marketManager.priorityList.length; i++) {
            const resource = state.marketManager.priorityList[i];
            let marketElement = $('#script_market_' + resource.id + 'Toggle');

            let toggle = $('<span class="has-text-info" style="margin-left: 20px;">' + resource.name + '</span>');
            marketElement.append(toggle);

            marketElement = marketElement.next();
            marketElement.append(buildMarketSettingsToggle(resource, "autoBuyEnabled", "script_buy2_" + resource.id, "script_buy1_" + resource.id, "autoSellEnabled", "script_sell2_" + resource.id, "script_sell1_" + resource.id));

            marketElement = marketElement.next();
            marketElement.append(buildMarketSettingsInput(resource, "res_buy_r_" + resource.id, "autoBuyRatio"));

            marketElement = marketElement.next();
            marketElement.append(buildMarketSettingsToggle(resource, "autoSellEnabled", "script_sell2_" + resource.id, "script_sell1_" + resource.id, "autoBuyEnabled", "script_buy2_" + resource.id, "script_buy1_" + resource.id));

            marketElement = marketElement.next();
            marketElement.append(buildMarketSettingsInput(resource, "res_sell_r_" + resource.id, "autoSellRatio"));

            marketElement = marketElement.next();
            marketElement.append(buildMarketSettingsToggle(resource, "autoTradeBuyEnabled", "script_tbuy2_" + resource.id, "script_tbuy1_" + resource.id, "autoTradeSellEnabled", "script_tsell2_" + resource.id, "script_tsell1_" + resource.id));

            marketElement = marketElement.next();
            marketElement.append(buildMarketSettingsInput(resource, "res_trade_buy_mtr_" + resource.id, "autoTradeBuyRoutes"));

            marketElement = marketElement.next();
            marketElement.append(buildMarketSettingsToggle(resource, "autoTradeSellEnabled", "script_tsell2_" + resource.id, "script_tsell1_" + resource.id, "autoTradeBuyEnabled", "script_tbuy2_" + resource.id, "script_tbuy1_" + resource.id));

            marketElement = marketElement.next();
            marketElement.append(buildMarketSettingsInput(resource, "res_trade_sell_mps_" + resource.id, "autoTradeSellMinPerSecond"));

            marketElement = marketElement.next();
            marketElement.append($('<span class="scriptlastcolumn"></span>'));
        }

        $('#script_marketTableBody').sortable( {
            items: "tr:not(.unsortable)",
            helper: function(event, ui){
                var $clone =  $(ui).clone();
                $clone .css('position','absolute');
                return $clone.get(0);
            },
            update: function() {
                let marketIds = $('#script_marketTableBody').sortable('toArray', {attribute: 'value'});

                for (let i = 0; i < marketIds.length; i++) {
                    // Market has been dragged... Update all market priorities
                    state.marketManager.priorityList[findArrayIndex(state.marketManager.priorityList, "id", marketIds[i])].marketPriority = i;
                }

                state.marketManager.sortByPriority();
                updateSettingsFromState();
            },
        } );
    }

    /**
     * @param {Resource} resource
     */
    function buildMarketSettingsToggle(resource, property, toggleId, syncToggleId, oppositeProperty, oppositeToggleId, oppositeSyncToggleId) {
        let checked = resource[property] ? " checked" : "";
        let toggle = $('<label id="' + toggleId + '" tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span><span style="margin-left: 20px;"></span></label>');

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = input.checked;
            resource[property] = state;

            let otherCheckbox =  document.querySelector('#' + syncToggleId + ' input');
            if (otherCheckbox !== null) {
                // @ts-ignore
                otherCheckbox.checked = state;
            }

            if (resource[property] && resource[oppositeProperty]) {
                resource[oppositeProperty] = false;

                let oppositeCheckbox1 =  document.querySelector('#' + oppositeToggleId + ' input');
                if (oppositeCheckbox1 !== null) {
                    // @ts-ignore
                    oppositeCheckbox1.checked = false;
                }

                let oppositeCheckbox2 =  document.querySelector('#' + oppositeSyncToggleId + ' input');
                if (oppositeCheckbox2 !== null) {
                    // @ts-ignore
                    oppositeCheckbox2.checked = false;
                }
            }

            updateSettingsFromState();
            //console.log(resource.name + " changed enabled to " + state);
        });

        return toggle;
    }

    /**
     * @param {Resource} resource
     */
    function buildMarketSettingsInput(resource, settingKey, property) {
        let textBox = $('<input type="text" class="input is-small" style="width:100%"/>');
        textBox.val(settings[settingKey]);
    
        textBox.on('change', function() {
            let val = textBox.val();
            let parsedValue = getRealNumber(val);
            if (!isNaN(parsedValue)) {
                //console.log('Setting resource max for resource ' + resource.name + ' to be ' + max);
                resource[property] = parsedValue;
                updateSettingsFromState();
            }
        });

        return textBox;
    }
    
    function buildStorageSettings() {
        let sectionId = "storage";
        let sectionName = "Storage";

        let resetFunction = function() {
            resetStorageState();
            resetStorageSettings();
            updateSettingsFromState();
            updateStorageSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateStorageSettingsContent);
    }

    function updateStorageSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_storageContent');
        currentNode.empty().off("*");

        updateStoragePreTable();
        updateStorageTable();

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function updateStoragePreTable() {
        let currentNode = $('#script_storageContent');

        // Add the pre table section
        //currentNode.append('<div style="margin-top: 10px; margin-bottom: 10px;" id="script_storagePreTable">' + '<div><span class="has-text-danger">Storage settings have not yet been implemented! You can change them but they won\'t take effect until a future version.</span></div>' + '</div>');
        currentNode.append('<div style="margin-top: 10px; margin-bottom: 10px;" id="script_storagePreTable"></div>');

        // Add any pre table settings
        let preTableNode = $('#script_storagePreTable');
        addStandardSectionSettingsToggle(preTableNode, "storageLimitPreMad", "Limit Pre-MAD Storage", "Saves resources and shortens run time by limiting storage pre-MAD");
    }

    function updateStorageTable() {
        let currentNode = $('#script_storageContent');
        currentNode.append(
            `<table style="width:100%"><tr><th class="has-text-warning" style="width:20%">Resource</th><th class="has-text-warning" style="width:20%">Enabled</th><th class="has-text-warning" style="width:20%">Weighting</th><th class="has-text-warning" style="width:20%">Max Crates</th><th class="has-text-warning" style="width:20%">Max Containers</th></tr>
                <tbody id="script_storageTableBody" class="scriptcontenttbody"></tbody>
            </table>`
        );

        let tableBodyNode = $('#script_storageTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < state.storageManager.priorityList.length; i++) {
            const resource = state.storageManager.priorityList[i];
            let classAttribute = ' class="scriptdraggable"';
            newTableBodyText += '<tr value="' + resource.id + '"' + classAttribute + '><td id="script_storage_' + resource.id + 'Toggle" style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td></tr>';
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other storages settings rows
        for (let i = 0; i < state.storageManager.priorityList.length; i++) {
            const resource = state.storageManager.priorityList[i];
            let storageElement = $('#script_storage_' + resource.id + 'Toggle');

            let toggle = $('<span class="has-text-info" style="margin-left: 20px;">' + resource.name + '</span>');
            storageElement.append(toggle);

            storageElement = storageElement.next();
            storageElement.append(buildStorageSettingsEnabledToggle(resource));

            storageElement = storageElement.next();
            storageElement.append(buildStorageSettingsInput(resource, "res_storage_w_" + resource.id, "autoStorageWeighting"));

            storageElement = storageElement.next();
            storageElement.append(buildStorageSettingsInput(resource, "res_crates_m_" + resource.id, "_autoCratesMax"));

            storageElement = storageElement.next();
            storageElement.append(buildStorageSettingsInput(resource, "res_containers_m_" + resource.id, "_autoContainersMax"));

            storageElement.append($('<span class="scriptlastcolumn"></span>'));
        }

        $('#script_storageTableBody').sortable( {
            items: "tr:not(.unsortable)",
            helper: function(event, ui){
                var $clone =  $(ui).clone();
                $clone .css('position','absolute');
                return $clone.get(0);
            },
            update: function() {
                let storageIds = $('#script_storageTableBody').sortable('toArray', {attribute: 'value'});

                for (let i = 0; i < storageIds.length; i++) {
                    // Storage has been dragged... Update all storage priorities
                    state.storageManager.priorityList[findArrayIndex(state.storageManager.priorityList, "id", storageIds[i])].storagePriority = i;
                }

                state.storageManager.sortByPriority();
                updateSettingsFromState();
            },
        } );
    }

    /**
     * @param {Resource} resource
     */
    function buildStorageSettingsEnabledToggle(resource) {
        let checked = resource.autoStorageEnabled ? " checked" : "";
        let toggle = $('<label id=script_res_storage_' + resource.id + ' tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span><span style="margin-left: 20px;"></span></label>');

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = input.checked;
            resource.autoStorageEnabled = state;
            updateSettingsFromState();
            //console.log(resource.name + " changed enabled to " + state);
        });

        return toggle;
    }

    /**
     * @param {Resource} resource
     * @param {string} settingKey
     * @param {string} property
     */
    function buildStorageSettingsInput(resource, settingKey, property) {
        let textBox = $('<input type="text" class="input is-small" style="width:25%"/>');
        textBox.val(settings[settingKey]);
    
        textBox.on('change', function() {
            let val = textBox.val();
            let parsedValue = getRealNumber(val);
            if (!isNaN(parsedValue)) {
                //console.log('Setting resource max for resource ' + resource.name + ' to be ' + max);
                resource[property] = parsedValue;
                updateSettingsFromState();
            }
        });

        return textBox;
    }

    function buildJobSettings() {
        let sectionId = "job";
        let sectionName = "Job";

        let resetFunction = function() {
            resetJobState();
            updateSettingsFromState();
            updateJobSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateJobSettingsContent);
    }

    function updateJobSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_jobContent');
        currentNode.empty().off("*");
        currentNode.append(
            `<table style="width:100%"><tr><th class="has-text-warning" style="width:25%">Job</th><th class="has-text-warning" style="width:25%">1st Pass Max</th><th class="has-text-warning" style="width:25%">2nd Pass Max</th><th class="has-text-warning" style="width:25%">Final Max</th></tr>
                <tbody id="script_jobTableBody" class="scriptcontenttbody"></tbody>
            </table>`
        );

        let tableBodyNode = $('#script_jobTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < state.jobManager.priorityList.length; i++) {
            const job = state.jobManager.priorityList[i];
            let classAttribute = job !== state.jobs.Farmer ? ' class="scriptdraggable"' : ' class="unsortable"';
            newTableBodyText += '<tr value="' + job._originalId + '"' + classAttribute + '><td id="script_' + job._originalId + 'Toggle" style="width:25%"></td><td style="width:25%"></td><td style="width:25%"></td><td style="width:25%"></td></tr>';
        }
        tableBodyNode.append($(newTableBodyText));

        for (let i = 0; i < state.jobManager.priorityList.length; i++) {
            const job = state.jobManager.priorityList[i];
            let jobElement = $('#script_' + job._originalId + 'Toggle');

            var toggle = buildJobSettingsToggle(job);
            jobElement.append(toggle);

            jobElement = jobElement.next();
            jobElement.append(buildJobSettingsInput(job, 1));
            jobElement = jobElement.next();
            jobElement.append(buildJobSettingsInput(job, 2));
            jobElement = jobElement.next();
            jobElement.append(buildJobSettingsInput(job, 3));
        }

        $('#script_jobTableBody').sortable( {
            items: "tr:not(.unsortable)",
            helper: function(event, ui){
                var $clone =  $(ui).clone();
                $clone .css('position','absolute');
                return $clone.get(0);
            },
            update: function() {
                let jobIds = $('#script_jobTableBody').sortable('toArray', {attribute: 'value'});

                for (let i = 0; i < jobIds.length; i++) {
                    // Job has been dragged... Update all job priorities
                    state.jobManager.priorityList[findArrayIndex(state.jobManager.priorityList, "_originalId", jobIds[i])].priority = i + 1; // farmers is always 0
                }

                state.jobManager.sortByPriority();
                updateSettingsFromState();
            },
        } );

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    /**
     * @param {Job} job
     */
    function buildJobSettingsToggle(job) {
        let checked = job.autoJobEnabled ? " checked" : "";
        let classAttribute = !job.isCraftsman() ? ' class="has-text-info"' : ' class="has-text-danger"';
        let marginTop = job !== state.jobs.Farmer ? ' margin-top: 4px;' : "";
        let toggle = $('<label tabindex="0" class="switch" style="position:absolute;' + marginTop + ' margin-left: 10px;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span><span' + classAttribute + ' style="margin-left: 20px;">' + job._originalName + '</span></label>');

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            job.autoJobEnabled = input.checked;
            updateSettingsFromState();
            //console.log(job._originalName + " changed state to " + state);
        });

        return toggle;
    }

    /**
     * @param {Job} job
     * @param {number} breakpoint
     */
    function buildJobSettingsInput(job, breakpoint) {
        let lastSpan = breakpoint === 3 && job !== state.jobs.Farmer ? '<span class="scriptlastcolumn"></span>' : "";

        if (job === state.jobs.Farmer || (breakpoint === 3 && (job === state.jobs.Lumberjack || job === state.jobs.QuarryWorker))) {
            let span = $('<span>Managed</span>' + lastSpan);
            return span;
        }

        let jobBreakpointTextbox = $('<input type="text" class="input is-small" style="width:25%"/>' + lastSpan);
        jobBreakpointTextbox.val(settings["job_b" + breakpoint + "_" + job._originalId]);
    
        jobBreakpointTextbox.on('change', function() {
            let val = jobBreakpointTextbox.val();
            let employees = getRealNumber(val);
            if (!isNaN(employees)) {
                //console.log('Setting job breakpoint ' + breakpoint + ' for job ' + job._originalName + ' to be ' + employees);
                job.setBreakpoint(breakpoint, employees);
                updateSettingsFromState();
            }
        });

        return jobBreakpointTextbox;
    }

    function buildBuildingSettings() {
        let sectionId = "building";
        let sectionName = "Building";

        let resetFunction = function() {
            resetBuildingState();
            updateSettingsFromState();
            updateBuildingSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateBuildingSettingsContent);
    }

    function updateBuildingSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_buildingContent');
        currentNode.empty().off("*");

        updateBuildingPreTable();
        updateBuildingTable();

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function updateBuildingPreTable() {
        // let currentNode = $('#script_marketContent');
        // currentNode.append(
        //     `<div style="margin-top: 10px; margin-bottom: 10px;" id="script_marketPreTable">
        //         <div style="margin-top: 5px; width: 400px"><label for="script_market_minmoneypersecond">Trade minimum money /s</label><input id="script_market_minmoneypersecond" type="text" class="input is-small" style="width: 150px; float: right;"></input></div>
        //     </div>`
        // );

        // let textBox = $('#script_market_minmoneypersecond');
        // textBox.val(settings.tradeRouteMinimumMoneyPerSecond);
    
        // textBox.on('change', function() {
        //     let val = textBox.val();
        //     let parsedValue = getRealNumber(val);
        //     if (!isNaN(parsedValue)) {
        //         //console.log('Setting resource max for resource ' + resource.name + ' to be ' + max);
        //         settings.tradeRouteMinimumMoneyPerSecond = parsedValue;
        //         updateSettingsFromState();
        //     }
        // });
    }

    function updateBuildingTable() {
        let currentNode = $('#script_buildingContent');
        currentNode.append(
            `<div><input id="script_buildingSearch" class="scriptsearchsettings" type="text" placeholder="Search for buildings.."></div>
            <table style="width:100%"><tr><th class="has-text-warning" style="width:40%">Building</th><th class="has-text-warning" style="width:20%">Auto Build</th><th class="has-text-warning" style="width:20%">Max Build</th><th class="has-text-warning" style="width:20%">Manage State</th></tr>
                <tbody id="script_buildingTableBody" class="scriptcontenttbody"></tbody>
            </table>`
        );

        let tableBodyNode = $('#script_buildingTableBody');
        let newTableBodyText = "";

        $("#script_buildingSearch").on("keyup", filterBuildingSettingsTable); // Add building filter

        // Add in a first row for switching "All"
        newTableBodyText += '<tr value="All" class="unsortable"><td id="script_bldallToggle" style="width:40%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td></tr>';

        for (let i = 0; i < state.buildingManager.priorityList.length; i++) {
            const building = state.buildingManager.priorityList[i];
            let classAttribute = ' class="scriptdraggable"';
            newTableBodyText += '<tr value="' + building.id + '"' + classAttribute + '><td id="script_' + building.id + 'Toggle" style="width:40%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td></tr>';
        }
        tableBodyNode.append($(newTableBodyText));

        // Build special "All Buildings" top row
        let buildingElement = $('#script_bldallToggle');
        let toggle = $('<span class="has-text-warning" style="margin-left: 20px;">All Buildings</span>');
        buildingElement.append(toggle);

        // enabled column
        buildingElement = buildingElement.next();
        toggle = buildAllBuildingEnabledSettingsToggle(state.buildingManager.priorityList);
        buildingElement.append(toggle);

        // max column
        buildingElement = buildingElement.next();
        buildingElement.append($('<span></span>'));

        // state column
        buildingElement = buildingElement.next();
        toggle = buildAllBuildingStateSettingsToggle(state.buildingManager.priorityList);
        buildingElement.append(toggle);

        // Build all other buildings settings rows
        for (let i = 0; i < state.buildingManager.priorityList.length; i++) {
            const building = state.buildingManager.priorityList[i];
            let buildingElement = $('#script_' + building.id + 'Toggle');

            let classAttribute = building._tabPrefix === "city" ? ' class="has-text-info"' : ' class="has-text-danger"';
            let toggle = $('<span' + classAttribute + ' style="margin-left: 20px;">' + building.name + '</span>');
            buildingElement.append(toggle);

            buildingElement = buildingElement.next();
            toggle = buildBuildingEnabledSettingsToggle(building);
            buildingElement.append(toggle);

            buildingElement = buildingElement.next();
            buildingElement.append(buildBuildingMaxSettingsInput(building));

            buildingElement = buildingElement.next();
            toggle = buildBuildingStateSettingsToggle(building);
            buildingElement.append(toggle);
        }

        $('#script_buildingTableBody').sortable( {
            items: "tr:not(.unsortable)",
            helper: function(event, ui){
                var $clone =  $(ui).clone();
                $clone .css('position','absolute');
                return $clone.get(0);
            },
            update: function() {
                let buildingIds = $('#script_buildingTableBody').sortable('toArray', {attribute: 'value'});

                for (let i = 0; i < buildingIds.length; i++) {
                    // Building has been dragged... Update all building priorities
                    if (buildingIds[i] !== "All") {
                        state.buildingManager.priorityList[findArrayIndex(state.buildingManager.priorityList, "id", buildingIds[i])].priority = i - 1;
                    }
                }

                state.buildingManager.sortByPriority();
                updateSettingsFromState();
            },
        } );
    }

    function filterBuildingSettingsTable() {
        // Declare variables
        let input = document.getElementById("script_buildingSearch");
        //@ts-ignore
        let filter = input.value.toUpperCase();
        let table = document.getElementById("script_buildingTableBody");
        let trs = table.getElementsByTagName("tr");

        // Loop through all table rows, and hide those who don't match the search query
        for (let i = 0; i < trs.length; i++) {
            let td = trs[i].getElementsByTagName("td")[0];
            if (td) {
                if (td.textContent.toUpperCase().indexOf(filter) > -1) {
                    trs[i].style.display = "";
                } else {
                    trs[i].style.display = "none";
                }
            }
        }
    }

    /**
     * @param {Action} building
     */
    function buildBuildingEnabledSettingsToggle(building) {
        let checked = building.autoBuildEnabled ? " checked" : "";
        let toggle = $('<label id=script_bat2_' + building.id + ' tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span><span style="margin-left: 20px;"></span></label>');

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = input.checked;
            building.autoBuildEnabled = state;
            //$('#script_bat1_' + building.id + ' input').checked = state; // Update the on-building toggle
            let otherCheckbox =  document.querySelector('#script_bat1_' + building.id + ' input');
            if (otherCheckbox !== null) {
                // @ts-ignore
                otherCheckbox.checked = state;
            }
            updateSettingsFromState();
            //console.log(building.name + " changed enabled to " + state);
        });

        return toggle;
    }

    /**
     * @param {Action[]} buildings
     */
    function buildAllBuildingEnabledSettingsToggle(buildings) {
        let checked = settings.buildingEnabledAll ? " checked" : "";
        let toggle = $('<label tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span><span style="margin-left: 20px;"></span></label>');

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = input.checked;

            settings.buildingEnabledAll = state;

            for (let i = 0; i < buildings.length; i++) {
                buildings[i].autoBuildEnabled = state;
            }

            let toggles = document.querySelectorAll('[id^="script_bat"] input');

            for (let i = 0; i < toggles.length; i++) {
                // @ts-ignore
                toggles[i].checked = state;
            }

            updateSettingsFromState();
            //console.log(building.name + " changed enabled to " + state);
        });

        return toggle;
    }
    
    /**
     * @param {Action} building
     */
    function buildBuildingStateSettingsToggle(building) {
        let toggle = null;
        let checked = building.autoStateEnabled ? " checked" : "";

        if (building.hasConsumption()) {
            toggle = $('<label id=script_bld_s_' + building.id + ' tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span><span style="margin-left: 20px;"></span></label><span class="scriptlastcolumn"></span>');
        } else {
            toggle = $('<span class="scriptlastcolumn"></span>');
        }

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            building.autoStateEnabled = input.checked;
            updateSettingsFromState();
            //console.log(building.name + " changed state to " + state);
        });

        return toggle;
    }

    /**
     * @param {Action[]} buildings
     */
    function buildAllBuildingStateSettingsToggle(buildings) {
        let checked = settings.buildingStateAll ? " checked" : "";
        let toggle = $('<label tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span><span style="margin-left: 20px;"></span></label>');

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = input.checked;

            settings.buildingStateAll = state;
            
            for (let i = 0; i < buildings.length; i++) {
                buildings[i].autoStateEnabled = state;
            }

            let toggles = document.querySelectorAll('[id^="script_bld_s_"] input');

            for (let i = 0; i < toggles.length; i++) {
                // @ts-ignore
                toggles[i].checked = state;
            }

            updateSettingsFromState();
            //console.log(building.name + " changed state to " + state);
        });

        return toggle;
    }

    /**
     * @param {Action} building
     */
    function buildBuildingMaxSettingsInput(building) {
        let buildingMaxTextBox = $('<input type="text" class="input is-small" style="width:25%"/>');
        buildingMaxTextBox.val(settings["bld_m_" + building.id]);
    
        buildingMaxTextBox.on('change', function() {
            let val = buildingMaxTextBox.val();
            let max = getRealNumber(val);
            if (!isNaN(max)) {
                //console.log('Setting building max for building ' + building.name + ' to be ' + max);
                building.autoMax = max;
                updateSettingsFromState();
            }
        });

        return buildingMaxTextBox;
    }

    function buildProjectSettings() {
        let sectionId = "project";
        let sectionName = "A.R.P.A.";

        let resetFunction = function() {
            resetProjectSettings();
            resetProjectState();
            updateSettingsFromState();
            updateProjectSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateProjectSettingsContent);
    }

    function updateProjectSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_projectContent');
        currentNode.empty().off("*");

        updateProjectPreTable();
        updateProjectTable();

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function updateProjectPreTable() {
        let currentNode = $('#script_projectContent');

        // Add the pre table section
        currentNode.append('<div style="margin-top: 10px; margin-bottom: 10px;" id="script_projectPreTable"></div>');

        // Add any pre table settings
        let preTableNode = $('#script_projectPreTable');
        addStandardSectionSettingsToggle(preTableNode, "arpaBuildIfStorageFull", "Override and build if storage is full", "Overrides the below settings to still build A.R.P.A projects if resources are full");
        addStandardSectionSettingsNumber(preTableNode, "arpaBuildIfStorageFullCraftableMin", "Minimum craftables to keep if overriding", "A.R.P.A. projects that require crafted resources won't override and build if resources are below this amount");
        addStandardSectionSettingsNumber(preTableNode, "arpaBuildIfStorageFullResourceMaxPercent", "Maximim percent of resources if overriding", "A.R.P.A. project that require more than this percentage of a non-crafted resource won't override and build");
    }

    function updateProjectTable() {
        let currentNode = $('#script_projectContent');
        currentNode.append(
            `<table style="width:100%"><tr><th class="has-text-warning" style="width:25%">Project</th><th class="has-text-warning" style="width:25%">Max Build</th><th class="has-text-warning" style="width:50%"></th></tr>
                <tbody id="script_projectTableBody" class="scriptcontenttbody"></tbody>
            </table>`
        );

        let tableBodyNode = $('#script_projectTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < state.projectManager.priorityList.length; i++) {
            const project = state.projectManager.priorityList[i];
            let classAttribute = ' class="scriptdraggable"';
            newTableBodyText += '<tr value="' + project.id + '"' + classAttribute + '><td id="script_' + project.id + 'Toggle" style="width:25%"></td><td style="width:25%"></td><td style="width:50%"></td></tr>';
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other projects settings rows
        for (let i = 0; i < state.projectManager.priorityList.length; i++) {
            const project = state.projectManager.priorityList[i];
            let projectElement = $('#script_' + project.id + 'Toggle');

            let toggle = buildProjectSettingsToggle(project);
            projectElement.append(toggle);

            projectElement = projectElement.next();
            projectElement.append(buildProjectMaxSettingsInput(project));
        }

        $('#script_projectTableBody').sortable( {
            items: "tr:not(.unsortable)",
            helper: function(event, ui){
                var $clone =  $(ui).clone();
                $clone .css('position','absolute');
                return $clone.get(0);
            },
            update: function() {
                let projectIds = $('#script_projectTableBody').sortable('toArray', {attribute: 'value'});

                for (let i = 0; i < projectIds.length; i++) {
                    // Project has been dragged... Update all project priorities
                    state.projectManager.priorityList[findArrayIndex(state.projectManager.priorityList, "id", projectIds[i])].priority = i;
                }

                state.projectManager.sortByPriority();
                updateSettingsFromState();
            },
        } );
    }

    /**
     * @param {Project} project
     */
    function buildProjectSettingsToggle(project) {
        let checked = project.autoBuildEnabled ? " checked" : "";
        let toggle = $('<label id=script_arpa2_' + project.id + ' tabindex="0" class="switch" style="position:absolute; margin-top: 4px; margin-left: 10px;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span><span class="has-text-info" style="margin-left: 20px;">' + project.name + '</span></label>');

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = input.checked;
            project.autoBuildEnabled = state;
            // @ts-ignore
            document.querySelector('#script_arpa1_' + project.id + ' input').checked = state;
            updateSettingsFromState();
            //console.log(project.name + " changed enabled to " + state);
        });

        return toggle;
    }

    /**
     * @param {Project} project
     */
    function buildProjectMaxSettingsInput(project) {
        if (project === state.projects.LaunchFacility) {
            return $('<span style="width:25%"/>');
        }

        let projectMaxTextBox = $('<input type="text" class="input is-small" style="width:25%"/>');
        projectMaxTextBox.val(settings["arpa_m_" + project.id]);
    
        projectMaxTextBox.on('change', function() {
            let val = projectMaxTextBox.val();
            let max = getRealNumber(val);
            if (!isNaN(max)) {
                //console.log('Setting max for project ' + project.name + ' to be ' + max);
                project.autoMax = max;
                updateSettingsFromState();
            }
        });

        return projectMaxTextBox;
    }

    function createSettingToggle(name, enabledCallBack, disabledCallBack) {
        let elm = $('#autoScriptContainer');
        let toggle = $('<label tabindex="0" class="switch" id="'+name+'" style=""><input type="checkbox" value=false> <span class="check"></span><span>'+name+'</span></label></br>');
        elm.append(toggle);
        if (settings[name]) {
            toggle.click();
            toggle.children('input').attr('value', true);
            if (enabledCallBack !== undefined) {
                enabledCallBack();
            }
        }
        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = !(input.getAttribute('value') === "true");
            input.setAttribute('value', state);
            settings[name] = state;
            updateSettingsFromState();
            if (state && enabledCallBack !== undefined) {
                enabledCallBack();
            } else if (disabledCallBack !== undefined) {
                disabledCallBack()
            }
        });
    }

    function updateUI() {
        let resetScrollPositionRequired = false;
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        if ($('#autoScriptContainer').length === 0) {
            let autoScriptContainer = $('<div id="autoScriptContainer"></div>');
            $('#resources').append(autoScriptContainer);
            resetScrollPositionRequired = true;
        }

        if ($("#script_settings").length === 0) {
            createScriptSettings();
        }
        
        let autoScriptContainerNode = document.querySelector('#autoScriptContainer');
        if (autoScriptContainerNode.nextSibling !== null) {
            autoScriptContainerNode.parentNode.appendChild(autoScriptContainerNode);
            resetScrollPositionRequired = true;
        }
        if ($('#autoScriptInfo').length === 0) {
            let elm = $('#autoScriptContainer');
            let span = $('<label id="autoScriptInfo">More options available in Settings tab</label></br>');
            elm.append(span);
        }
        if ($('#autoEvolution').length === 0) {
            createSettingToggle('autoEvolution');
        }
        if ($('#autoAchievements').length === 0) {
            createSettingToggle('autoAchievements');
        }
        if ($('#autoChallenge').length === 0) {
            createSettingToggle('autoChallenge');
        }
        if ($('#autoFight').length === 0) {
            createSettingToggle('autoFight');
        }
        if ($('#autoCraft').length === 0) {
            createSettingToggle('autoCraft', createCraftToggles, removeCraftToggles);
        } else if (settings.autoCraft && $('.ea-craft-toggle').length === 0) {
            createCraftToggles();
        }
        if ($('#autoBuild').length === 0) {
            createSettingToggle('autoBuild', createBuildingToggles, removeBuildingToggles);
        } else if (settings.autoBuild && $('.ea-building-toggle').length === 0) {
            createBuildingToggles();
        }
        if ($('#autoMarket').length === 0) {
            createSettingToggle('autoMarket', createMarketToggles, removeMarketToggles);
        } else if (settings.autoMarket > 0 && $('.ea-market-toggle').length === 0 && isMarketUnlocked()) {
            createMarketToggles()
        }
        if ($('#autoStorage').length === 0) {
            createSettingToggle('autoStorage');
        }
        if ($('#autoResearch').length === 0) {
            createSettingToggle('autoResearch');
        }
        if ($('#autoARPA').length === 0) {
            createSettingToggle('autoARPA', createArpaToggles, removeArpaToggles);
        } else if (settings.autoARPA && $('.ea-arpa-toggle').length === 0) {
            createArpaToggles();
        }

        if ($('#autoJobs').length === 0) {
            createSettingToggle('autoJobs');
        }
        if ($('#autoTax').length === 0) {
            createSettingToggle('autoTax');
        }
        if ($('#autoCraftsmen').length === 0) {
            createSettingToggle('autoCraftsmen');
        }
        if ($('#autoPower').length === 0) {
            createSettingToggle('autoPower');
        }
        if ($('#autoSmelter').length === 0) {
            createSettingToggle('autoSmelter');
        }
        if ($('#autoFactory').length === 0) {
            createSettingToggle('autoFactory');
        }
        if ($('#autoMAD').length === 0) {
            createSettingToggle('autoMAD');
        }
        if ($('#autoSpace').length === 0) {
            createSettingToggle('autoSpace');
        }
        if ($('#autoSeeder').length === 0) {
            createSettingToggle('autoSeeder');
        }
        if ($('#autoAssembleGene').length === 0) {
            createSettingToggle('autoAssembleGene');
        }
        if (showLogging && $('#autoLogging').length === 0) {
           createSettingToggle('autoLogging');

           let settingsDiv = $('<div id="ea-logging"></div>');
           let logTypeTxt = $('<div>Logging Type:</div>')
           let logTypeInput = $('<input type="text" class="input is-small" style="width:32%"/>');
           logTypeInput.val(loggingType);
           let setBtn = $('<a class="button is-dark is-small" id="set-loggingType"><span>set</span></a>');
           settingsDiv.append(logTypeTxt).append(logTypeInput).append(setBtn);
           $('#autoScriptContainer').append(settingsDiv);

           setBtn.on('mouseup', function() {
               let val = logTypeInput.val();
               loggingType = val;
           });
        }
        if ($('#bulk-sell').length === 0 && isMarketUnlocked()) {
            let bulkSell = $('<a class="button is-dark is-small" id="bulk-sell"><span>Bulk Sell</span></a>');
            $('#autoScriptContainer').append(bulkSell);
            bulkSell.on('mouseup', function(e) {
                autoMarket(true, true);
            });
        } if ($('#ea-settings').length === 0) {
            let settingsDiv = $('<div id="ea-settings"></div>');
            let minMoneyTxt = $('<div>Minimum money to keep :</div>')
            let minMoneyInput = $('<input type="text" class="input is-small" style="width:32%"/>');
            let minimumMoneyValue = settings.minimumMoney > 0 ? settings.minimumMoney : settings.minimumMoneyPercentage;
            minMoneyInput.val(minimumMoneyValue);
            let setBtn = $('<a class="button is-dark is-small" id="set-min-money"><span>Set</span></a>');
            let setPercentBtn = $('<a class="button is-dark is-small" id="set-min-money" title="eg. 10 equals 10%"><span>Set %</span></a>');
            settingsDiv.append(minMoneyTxt).append(minMoneyInput).append(setBtn).append(setPercentBtn);
            $('#autoScriptContainer').append(settingsDiv);

            setBtn.on('click', function() {
                let val = minMoneyInput.val();
                let minMoney = getRealNumber(val);
                if (!isNaN(minMoney)) {
                    console.log('Setting minimum money to : ' + minMoney);
                    settings.minimumMoney = minMoney;
                    settings.minimumMoneyPercentage = 0;
                    updateSettingsFromState();
                }
            });

            setPercentBtn.on('click', function() {
                let val = minMoneyInput.val();
                let minMoneyPercent = getRealNumber(val);
                if (!isNaN(minMoneyPercent)) {
                    console.log('Setting minimum money percentage to : ' + minMoneyPercent);
                    settings.minimumMoneyPercentage = minMoneyPercent;
                    settings.minimumMoney = 0;
                    updateSettingsFromState();
                }
            });
        }

        if (resetScrollPositionRequired) {
            // Leave the scroll position where it was before all our updates to the UI above
            document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
        }
    }

    /**
     * @param {Project} project
     */
    function createArpaToggle(project) {
        let checked = project.autoBuildEnabled ? " checked" : "";
        let arpaDiv = $('#arpa' + project.id + ' .head');
        let toggle = $('<label id=script_arpa1_' + project.id + ' tabindex="0" class="switch ea-arpa-toggle" style="position:relative; max-width:75px;margin-top: -36px;left:45%;float:left;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px;"></span></label>');
        arpaDiv.append(toggle);
        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = input.checked;
            project.autoBuildEnabled = state;
            // @ts-ignore
            document.querySelector('#script_arpa2_' + project.id + ' input').checked = state;
            updateSettingsFromState();
        });
    }

    function createArpaToggles() {
        removeArpaToggles();
        createArpaToggle(state.projects.SuperCollider);
        createArpaToggle(state.projects.StockExchange);
        createArpaToggle(state.projects.Monument);
        
        if (state.projects.LaunchFacility.isUnlocked()) {
            createArpaToggle(state.projects.LaunchFacility);
        }
    }

    function removeArpaToggles() {
        $('.ea-arpa-toggle').remove();
    }

    /**
     * @param {Resource} craftable
     */
    function createCraftToggle(craftable) {
        let resourceSpan = $('#res' + craftable.id);
        let toggle = $('<label tabindex="0" class="switch ea-craft-toggle" style="position:absolute; max-width:75px;margin-top: 4px;left:8%;"><input type="checkbox" value=false> <span class="check" style="height:5px;"></span></label>');
        resourceSpan.append(toggle);
        if (craftable.autoCraftEnabled) {
            toggle.click();
            toggle.children('input').attr('value', true);
        }
        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = !(input.getAttribute('value') === "true");
            input.setAttribute('value', state);
            craftable.autoCraftEnabled = state;
            updateSettingsFromState();
        });
    }

    function createCraftToggles() {
        removeCraftToggles();
        for (let i = 0; i < state.craftableResourceList.length; i++) {
            let craftable = state.craftableResourceList[i];
            createCraftToggle(craftable);
        }
    }

    function removeCraftToggles() {
        $('.ea-craft-toggle').remove();
    }

    /**
     * @param {Action} building
     */
    function createBuildingToggle(building) {
        let checked = building.autoBuildEnabled ? " checked" : "";
        let buildingElement = $('#' + building._tabPrefix + '-' + building.id);
        let toggle = $('<label id=script_bat1_' + building.id + ' tabindex="0" class="switch ea-building-toggle" style="position:absolute; margin-top: 24px;left:10%;"><input type="checkbox"' + checked + '> <span class="check" style="height:5px; max-width:15px"></span></label>');
        buildingElement.append(toggle);

        toggle.on('change', function(e) {
            let input = e.currentTarget.children[0];
            let state = input.checked;
            building.autoBuildEnabled = state;
            //$('#script_bat2_' + building.id + ' input').checked = state; // Update the settings-building toggle
            let otherCheckbox = document.querySelector('#script_bat2_' + building.id + ' input');
            if (otherCheckbox !== null) {
                // @ts-ignore
                otherCheckbox.checked = state;
            }
            updateSettingsFromState();
        });
    }
    
    function createBuildingToggles() {
        removeBuildingToggles();
        
        for (let i = 0; i < state.buildingManager.priorityList.length; i++) {
            createBuildingToggle(state.buildingManager.priorityList[i]);
        }
    }
    
    function removeBuildingToggles() {
        $('.ea-building-toggle').remove();
    }

    /**
     * @param {Resource} resource
     */
    function createMarketToggle(resource) {
        let autoBuyChecked = resource.autoBuyEnabled ? " checked" : "";
        let autoSellChecked = resource.autoSellEnabled ? " checked" : "";
        let autoTradeBuyChecked = resource.autoTradeBuyEnabled ? " checked" : "";
        let marketRow = $('#market-' + resource.id);
        let toggleBuy = $('<label id="script_buy1_' +  resource.id + '" tabindex="0" title="Enable buying of this resource. When to buy is set in the Settings tab."  class="switch ea-market-toggle" style=""><input type="checkbox"' + autoBuyChecked + '> <span class="check" style="height:5px;"></span><span class="control-label" style="font-size: small;">buy</span><span class="state"></span></label>');
        let toggleSell = $('<label id="script_sell1_' +  resource.id + '" tabindex="0" title="Enable selling of this resource. When to sell is set in the Settings tab."  class="switch ea-market-toggle" style=""><input type="checkbox"' + autoSellChecked + '> <span class="check" style="height:5px;"></span><span class="control-label" style="font-size: small;">sell</span><span class="state"></span></label>');
        let toggleTrade = $('<label id="script_tbuy1_' +  resource.id + '" tabindex="0" title="Enable trading for this resource. Max routes is set in the Settings tab." class="switch ea-market-toggle" style=""><input type="checkbox"' + autoTradeBuyChecked + '> <span class="check" style="height:5px;"></span><span class="control-label" style="font-size: small;">trade for</span><span class="state"></span></label>');
        marketRow.append(toggleBuy);
        marketRow.append(toggleSell);
        marketRow.append(toggleTrade);

        toggleBuy.on('change', function(e) {
            //console.log(e);
            let input = e.currentTarget.children[0];
            let state = input.checked;
            resource.autoBuyEnabled = state;
            let otherCheckbox = document.querySelector('#script_buy2_' + resource.id + ' input');
            if (otherCheckbox !== null) {
                // @ts-ignore
                otherCheckbox.checked = state;
            }

            if (resource.autoBuyEnabled && resource.autoSellEnabled) {
                resource.autoSellEnabled = false;

                let sellCheckBox1 = document.querySelector('#script_sell1_' + resource.id + ' input');
                if (sellCheckBox1 !== null) {
                    // @ts-ignore
                    sellCheckBox1.checked = false;
                }

                let sellCheckBox2 = document.querySelector('#script_sell2_' + resource.id + ' input');
                if (sellCheckBox2 !== null) {
                    // @ts-ignore
                    sellCheckBox2.checked = false;
                }
            }

            updateSettingsFromState();
            //console.log(state);
        });

        toggleSell.on('change', function(e) {
            //console.log(e);
            let input = e.currentTarget.children[0];
            let state = input.checked;
            resource.autoSellEnabled = state;
            let otherCheckbox = document.querySelector('#script_sell2_' + resource.id + ' input');
            if (otherCheckbox !== null) {
                // @ts-ignore
                otherCheckbox.checked = state;
            }

            if (resource.autoSellEnabled && resource.autoBuyEnabled) {
                resource.autoBuyEnabled = false;

                let buyCheckBox1 = document.querySelector('#script_buy1_' + resource.id + ' input');
                if (buyCheckBox1 !== null) {
                    // @ts-ignore
                    buyCheckBox1.checked = false;
                }

                let buyCheckBox2 = document.querySelector('#script_buy2_' + resource.id + ' input');
                if (buyCheckBox2 !== null) {
                    // @ts-ignore
                    buyCheckBox2.checked = false;
                }
            }

            updateSettingsFromState();
            //console.log(state);
        });

        toggleTrade.on('change', function(e) {
            //console.log(e);
            let input = e.currentTarget.children[0];
            let state = input.checked;
            resource.autoTradeBuyEnabled = state;
            let otherCheckbox = document.querySelector('#script_tbuy2_' + resource.id + ' input');
            if (otherCheckbox !== null) {
                // @ts-ignore
                otherCheckbox.checked = state;
            }

            if (resource.autoTradeBuyEnabled && resource.autoTradeSellEnabled) {
                resource.autoTradeSellEnabled = false;

                let buyCheckBox1 = document.querySelector('#script_tsell1_' + resource.id + ' input');
                if (buyCheckBox1 !== null) {
                    // @ts-ignore
                    buyCheckBox1.checked = false;
                }

                let buyCheckBox2 = document.querySelector('#script_tsell2_' + resource.id + ' input');
                if (buyCheckBox2 !== null) {
                    // @ts-ignore
                    buyCheckBox2.checked = false;
                }
            }

            updateSettingsFromState();
            //console.log(state);
        });
    }

    function createMarketToggles() {
        removeMarketToggles();
        for (let i = 0; i < state.marketManager.priorityList.length; i++) {
            createMarketToggle(state.marketManager.priorityList[i]);
        }
    }

    function removeMarketToggles() {
        $('.ea-market-toggle').remove();
    }

    //#endregion UI

    //#region Utility Functions

    function isNoPlasmidChallenge() {
        // This isn't a good way to detect this but it will do for now
        return !state.jobManager.canManualCraft()
    }

    function isLowPlasmidCount() {
        return resources.plasmid.currentQuantity < 500 || isNoPlasmidChallenge()
    }

    var numberSuffix = {
        K: 1000,
        M: 1000000,
        G: 1000000000,
        T: 1000000000000,
        P: 1000000000000000,
        E: 1000000000000000000,
        Z: 1000000000000000000000,
        Y: 1000000000000000000000000,
    }

    /**
     * @param {string} amountText
     * @return {number}
     */
    function getRealNumber(amountText) {
        if (amountText === "") {
            return 0;
        }

        let numericPortion = parseFloat(amountText);
        let lastChar = amountText[amountText.length - 1];

        if (numberSuffix[lastChar] !== undefined) {
            numericPortion *= numberSuffix[lastChar];
        }

        return numericPortion;
    }

    /**
     * @return {boolean}
     */
    function isMarketUnlocked() {
        return $('#tech-market > .oldTech').length > 0;
    }

    /**
     * @param {string} research
     */
    function isResearchUnlocked(research) {
        return document.querySelector("#tech-" + research + " .oldTech") !== null
    }

    /**
     * @param {string} raceId
     */
    function isRaceTraitIntelligent(raceId) {
        return raceId === state.races.Cyclops.id;
    }

    /**
     * @param {number} buyValue
     * @return {boolean}
     */
    function wouldBreakMoneyFloor(buyValue) {
        if (buyValue <= 0) {
            return false;
        }

        return resources.money.currentQuantity - buyValue < state.minimumMoneyAllowed;
    }

    /**
     * @return {string}
     */
    function getRaceId() {
        let raceNameNode = document.querySelector('#race .column > span');
        if (raceNameNode === null) {
            return "";
        }

        let index = findArrayIndex(state.raceAchievementList, "name", raceNameNode.textContent);

        if (index === -1) {
            return "";
        }

        return state.raceAchievementList[index].id;
    }

    function isHunterRace() {
        // There are several hunter races but you can also gain the trait through fanaticism or deify
        let raceId = getRaceId();
        return raceId === state.races.Cath.id || raceId === state.races.Balorg.id || raceId === state.races.Imp.id || state.jobManager._unemployed.getHtmlName() === "Hunter";
    }

    function isEvilRace() {
        let raceId = getRaceId();
        return raceId === state.races.Balorg.id || raceId === state.races.Imp.id;
    }

    function isLumberRace() {
        let raceId = getRaceId();
        return raceId !== state.races.Entish.id && resources.lumber.isUnlocked();
    }

    function removePoppers() {
        let poppers = document.querySelectorAll('[id^="pop"]'); // popspace_ and // popspc

        for (let i = 0; i < poppers.length; i++) {
            poppers[i].remove();
        }
    }

    /**
     * @param {any[]} array
     * @param {string} propertyName
     * @param {any} propertyValue
     */
    function findArrayIndex(array, propertyName, propertyValue) {
        for (let i = 0; i < array.length; i++) {
            if (array[i][propertyName] === propertyValue) {
                return i;
            }
        }
        
        return -1;
    }

    var modifierKeyPressed = false;
    $(document).keydown(function(e){
        modifierKeyPressed = e.ctrlKey || e.shiftKey || e.altKey;
    });
    $(document).keyup(function(e){
        modifierKeyPressed = e.ctrlKey || e.shiftKey || e.altKey;
    });
    $(window).on('mousemove', function(e) {
        modifierKeyPressed = e.ctrlKey || e.shiftKey || e.altKey;
    });

    var showLogging = false;
    var loggingType = "autoStorage";

    /**
     * @param {string} type
     * @param {string} text
     */
    function log(type, text) {
        if (settings.autoLogging && type === loggingType) {
            console.log(text);
        }
    }

    //#endregion Utility Functions

    // Alt tabbing can leave modifier keys pressed. When the window loses focus release all modifier keys.
    $(window).on('blur', function(e) {
        let keyboardEvent = document.createEvent("KeyboardEvent");
        var initMethod = typeof keyboardEvent.initKeyboardEvent !== 'undefined' ? "initKeyboardEvent" : "initKeyEvent";

        keyboardEvent[initMethod](
          "keyup", // event type: keydown, keyup, keypress
          true,      // bubbles
          true,      // cancelable
          window,    // view: should be window
          false,     // ctrlKey
          false,     // altKey
          false,     // shiftKey
          false,     // metaKey
          0,        // keyCode: unsigned long - the virtual key code, else 0
          0          // charCode: unsigned long - the Unicode character associated with the depressed key, else 0
        );
        document.dispatchEvent(keyboardEvent);
    });

// @ts-ignore
})($);