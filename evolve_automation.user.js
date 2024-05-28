// ==UserScript==
// @name         Evolve
// @namespace    http://tampermonkey.net/
// @version      3.3.1.122
// @description  try to take over the world!
// @downloadURL  https://gist.github.com/Vollch/b1a5eec305558a48b7f4575d317d7dd1/raw/evolve_automation.user.js
// @updateURL    https://gist.github.com/Vollch/b1a5eec305558a48b7f4575d317d7dd1/raw/evolve_automation.meta.js
// @author       Fafnir
// @author       TMVictor
// @author       Vollch
// @author       schoeggu
// @author       davezatch
// @match        https://pmotschmann.github.io/Evolve/
// @grant        none
// @require      https://code.jquery.com/jquery-3.6.0.min.js
// @require      https://code.jquery.com/ui/1.12.1/jquery-ui.min.js
// ==/UserScript==
//
// This script forked from TMVictor's script version 3.3.1. Original script: https://gist.github.com/TMVictor/3f24e27a21215414ddc68842057482da
//
// Most of script options have tooltips, explaining what they do, read them if you have a questions.
//
// Here's some tips about non-intuitive features:
//   Script tends to do a lot of clicks. It highly recommended to have key multipliers enabled, and bound to Shift\Control\Alt\Meta keys(in any combinations) for best performance.
//   Ctrl+Click on almost any script option brings up advanced configurations, which allows to overide setting under certain conditions and set more advanced logic.
//     Triggers, evolution queue, log filters, smart powering for interlinked buildings(like transport and bireme), priorities(draggables), and overrides itself - cannot be overridden.
//     Overrides affects only script behaviour, GUI(outside of overrides modal) always show and changes default values.
//   autoMarket, autoGalaxyMarket, autoFactory, and autoMiningDroid use weightings and priorities to determine their tasks. Resources split by groups of same priority, and then resources within group having the best priority distributed according to their weights. If there's still some more unused routes\factories\drones after assigning, script moves to next group with lower priority, etc. In most cases only one group with highest priority is active and working, while other groups serve as fallback for cases when all resources with better priority are either capped, or, in case of factory, unaffordable. There's few special values for finer configuration:
//     Prioritization(queue, trigger, etc) does temporarily change priority of resource to 100, thus resources with priority above 100 won't be affected by prioritization.
//       You can also disable prioritization under General Settings, if you can't cope with it.
//     Priority of -1 it's special supplementary value meaning "same as current highest". Resources with this value will always be crafted among with whatever currently have highest priority, without disabling them.
//     Resources with 0 priority won't be crafted during normal workflow, unless prioritized(which increases priority).
//     Resources with 0 weighting won't ever be crafted, regardless of configured priority or prioritization.
//     autoMarket and autoFactory also have separate global checkboxes per resources, when they disabled(both buying and selling in case of autoMarket) - script won't touch them, leaving with whatever was manually set.
//   Added numbers in Mech Labs represents: design efficiency, real mech damage affected by most factors, and damage per used space, respectively. For all three - bigger numbers are better. Collectors show their supply collect rate.
//   Buildings\researches queue, triggers, and available researches prioritize missing resources, overiding other script settings. If you have issues with factories producing not what you want, market buying not what you want, and such - you can disable this feature under general settings.
//     Alternatively you may try to tweak options of producing facilities: resources with 0 weighting won't ever be produced, even when script tries to prioritize it. And resources with priority -1 will always have highest available priority, even when facility prioritizing something else. But not all facilities can be configured in that way.
//   Auto Storage assigns crates\containers to make enough storage to build all buildings with enabled Auto Build.
//     If some storage grew too high, taking all crates, you can disable expensive building, and Auto Storage won't try to fullfil its demands anymore. If you want to expand storage to build something manually, you can limit maximum level of building to 0, thus while it technically have auto build enabled, it won't ever be autobuilded, but you'll have needed storage.
//   Order in which buildings receive power depends on order in buildings settings, you can drag and drop them to adjust priorities.
//     Filtering works with names, some settings, and resource cost. E.g. you can filter for "build==on", "power==off", "weight<100", "soul gem>0", "iron>=1G" and such.
//     By default Ascension Trigger placed where it can be activated as soon as possible without killing soldiers or population, and reducing prestige rewards. But it still can hurt production badly. If you're planning to ascend at very first opportunity(i.e. not planning to go for pillar or such), you may enable auto powering it. Otherwise you may want to delay with it till the moment when you'll be ready. (Or you can just move it where it will be less impacting on production, but that also means it'll take longer to get enough power)
//     Auto Power have two toggles, first one enables basic management for building: based on priority, available power, support, and fuel. Logic behind second toggle is individual per building, but generally it tries to behave smart and save resources when it's enabled.
//   Evolution Queue can change any script settings, not only those which you have after adding new task, you can append any variables and their values manually, if you're capable to read code, and can find internal names and acceptable values of those variables. Settings applied at the moment when new evolution starts. (Or right before reset in case of Cataclysm)
//     Unavailable tasks in evolution queue will be ignored, so you can queue something like salamander and balorg, one after another, and configure script to pick either volcano or hellscape after bioseed. And, assuming you'll get either of these planets, it'll go for one of those two races. (You can configure more options to pick from, if you want)
//   Auto Smelter does adjust rate of Inferno fuel and Oil for best cost and efficiency, but only when Inferno directly above oil.
//   All settings can be reset to default at once by importing {} as script settings.
//   Autoclicker can trivialize many aspects of the game, and ruin experience. Spoil your game at your own risk!

(function($) {
    'use strict';

    // Export script info to the window.
    var debugMode = true;

    var settingsRaw = JSON.parse(localStorage.getItem('settings')) ?? {};
    var settings = {};
    var game = null;
    var win = null;

    var overrideKey = "ctrlKey";
    var overrideKeyLabel = "Ctrl";
    if (window.navigator.platform.indexOf("Mac") === 0) {
        overrideKey = "altKey";
        overrideKeyLabel = "Alt";
    }

    var checkActions = false;

    // Class definitions

    class Job {
        constructor(id, name, flags) {
            this._originalId = id;
            this._originalName = name;
            this._workerBinding = "civ-" + this._originalId;

            this.is = normalizeProperties(flags) ?? {};
        }

        get autoJobEnabled() { return settings['job_' + this._originalId] }
        get isSmartEnabled() { return settings['job_s_' + this._originalId] }
        get priority() { return settingsRaw['job_p_' + this._originalId] }
        getBreakpoint(n) { return settings[`job_b${n+1}_${this._originalId}`] }

        get definition() {
            return game.global.civic[this._originalId];
        }

        get id() {
            return this.definition.job;
        }

        get name() {
            return this.definition.name;
        }

        isUnlocked() {
            return this.definition.display;
        }

        isManaged() {
            if (!this.isUnlocked()) {
                return false;
            }

            return this.autoJobEnabled;
        }

        get workers() {
            return this.definition.workers;
        }

        get servants() {
            return 0;
        }

        get count() {
            return this.workers + (this.servants * traitVal('high_pop', 0, 1));
        }

        get max() {
            return this.definition.max;
        }

        breakpointEmployees(breakpoint, ignoreMax) {
            let breakpointActual = this.getBreakpoint(breakpoint);

            // -1 equals unlimited up to the maximum available jobs for this job
            if (breakpointActual === -1) {
                breakpointActual = Number.MAX_SAFE_INTEGER;
            } else if (settings.jobScalePop && this._originalId !== "hell_surveyor"){
                breakpointActual *= traitVal('high_pop', 0, 1);
            }

            // return the actual workers required for this breakpoint (either our breakpoint or our max, whichever is lower)
            return ignoreMax ? breakpointActual : Math.min(breakpointActual, this.max);
        }

        addWorkers(count) {
            if (this.isDefault()) {
                return false;
            }
            if (count < 0) {
                this.removeWorkers(-1 * count);
            }

            let vue = getVueById(this._workerBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.add();
            }
        }

        removeWorkers(count) {
            if (this.isDefault()) {
                return false;
            }
            if (count < 0) {
                this.addWorkers(-1 * count);
            }

            let vue = getVueById(this._workerBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.sub();
            }
        }

        isDefault() {
            return false;
        }
    }

    class BasicJob extends Job {
        constructor(...args) {
            super(...args);

            this._servantBinding = "servant-" + this._originalId;
        }

        get servants() {
            return game.global.race.servants?.jobs[this._originalId] ?? 0;
        }

        get max() {
            return Number.MAX_SAFE_INTEGER;
        }

        addServants(count) {
            if (count < 0) {
                this.removeServants(-1 * count);
            }

            let vue = getVueById(this._servantBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.add();
            }
        }

        removeServants(count) {
            if (count < 0) {
                this.addServants(-1 * count);
            }

            let vue = getVueById(this._servantBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.sub();
            }
        }

        isDefault() {
            return game.global.civic.d_job === this.id;
        }

        setAsDefault() {
            getVueById(this._workerBinding)?.setDefault(this.id);
        }
    }

    class CraftingJob extends Job {
        constructor(id, name, resource) {
            super(id, name, {serve: true});

            this._crafterBinding = "foundry";
            this._servantBinding = "skilledServants";
            this.resource = resource;
        }

        get definition() {
            return game.global.civic['craftsman'];
        }

        get id() {
            return this.resource.id;
        }

        isUnlocked() {
            return game.global.resource[this._originalId].display;
        }

        get servants() {
            return game.global.race.servants?.sjobs[this._originalId] ?? 0;
        }

        get workers() {
            return game.global.city.foundry?.[this._originalId] ?? 0;
        }

        get max() {
            return game.global.civic.craftsman.max;
        }

        addWorkers(count) {
            if (!this.isUnlocked()) {
                return false;
            }
            if (count < 0) {
                this.removeWorkers(-1 * count);
            }

            let vue = getVueById(this._crafterBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.add(this._originalId);
            }
        }

        removeWorkers(count) {
            if (!this.isUnlocked()) {
                return false;
            }
            if (count < 0) {
                this.addWorkers(-1 * count);
            }

            let vue = getVueById(this._crafterBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.sub(this._originalId);
            }
        }

        addServants(count) {
            if (count < 0) {
                this.removeServants(-1 * count);
            }

            let vue = getVueById(this._servantBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.add(this._originalId);
            }
        }

        removeServants(count) {
            if (count < 0) {
                this.addServants(-1 * count);
            }

            let vue = getVueById(this._servantBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.sub(this._originalId);
            }
        }
    }

    class Resource {
        constructor(name, id, flags) {
            this.name = name;
            this._id = id;

            this.currentQuantity = 0;
            this.maxQuantity = 0;
            this.rateOfChange = 0;
            this.rateMods = {};
            this.tradeBuyPrice = 0;
            this.tradeSellPrice = 0;
            this.tradeRoutes = 0;
            this.incomeAdusted = false;

            this.maxCost = 0;
            this.storageRequired = 1;
            this.requestedQuantity = 0;
            this.cost = {};

            this._vueBinding = "res" + id;
            this._stackVueBinding = "stack-" + id;
            this._marketVueBinding = "market-" + id;

            this.is = normalizeProperties(flags) ?? {};
        }

        get autoCraftEnabled() { return settings['craft' + this.id] }
        get craftWeighting() { return settings['foundry_w_' + this.id] }
        get craftPreserve() { return settings['foundry_p_' + this.id] }
        get autoStorageEnabled() { return settings['res_storage' + this.id] }
        get storagePriority() { return settingsRaw['res_storage_p_' + this.id] }
        get storeOverflow() { return settings['res_storage_o_' + this.id] }
        get minStorage() { return settings['res_min_store' + this.id] }
        get maxStorage() { return settings['res_max_store' + this.id] }
        get marketPriority() { return settingsRaw['res_buy_p_' + this.id] }
        get autoBuyEnabled() { return settings['buy' + this.id] }
        get autoBuyRatio() { return settings['res_buy_r_' + this.id] }
        get autoSellEnabled() { return settings['sell' + this.id] }
        get autoSellRatio() { return settings['res_sell_r_' + this.id] }
        get autoTradeBuyEnabled() { return settings['res_trade_buy_' + this.id] }
        get autoTradeSellEnabled() { return settings['res_trade_sell_' + this.id] }
        get autoTradeWeighting() { return settings['res_trade_w_' + this.id] }
        get autoTradePriority() { return settings['res_trade_p_' + this.id] }
        get galaxyMarketWeighting() { return settings['res_galaxy_w_' + this.id] }
        get galaxyMarketPriority() { return settings['res_galaxy_p_' + this.id] }

        get title() {
            return this.instance?.name || this.name;
        }

        get instance() {
            return game.global.resource[this.id];
        }

        get id() {
            return this._id;
        }

        get currentCrates() {
            return this.instance.crates;
        }

        get currentContainers() {
            return this.instance.containers;
        }

        updateData() {
            if (!this.isUnlocked()) {
                return;
            }

            let instance = this.instance;
            this.currentQuantity = instance.amount;
            this.maxQuantity = instance.max >= 0 ? instance.max : Number.MAX_SAFE_INTEGER;
            this.rateOfChange = instance.diff;
            this.rateMods = {};
            this.incomeAdusted = false;
        }

        finalizeData() {
            if (!this.isUnlocked() || this.constructor !== Resource) { // Only needed for base resources
                return;
            }

            // When routes are managed - we're excluding trade diff from operational rate of change.
            if (settings.autoMarket && this.is.tradable) {
                this.tradeRoutes = this.instance.trade;
                this.tradeBuyPrice = game.tradeBuyPrice(this._id);
                this.tradeSellPrice = game.tradeSellPrice(this._id);
                let tradeDiff = game.breakdown.p.consume[this._id]?.Trade || 0;
                if (tradeDiff > 0) {
                    this.rateMods['buy'] = tradeDiff * -1;
                } else if (tradeDiff < 0) {
                    this.rateMods['sell'] = tradeDiff * -1;
                    this.rateOfChange += this.rateMods['sell'];
                }
            }

            // Restore decayed rate
            if (game.global.race['decay'] && this.tradeRouteQuantity > 0 && this.currentQuantity >= 50) {
                this.rateMods['decay'] = (this.currentQuantity - 50) * (0.001 * this.tradeRouteQuantity);
                this.rateOfChange += this.rateMods['decay'];
            }
        }

        calculateRateOfChange(apply) {
            let value = this.rateOfChange;
            for (let mod in this.rateMods) {
                if (apply[mod] ?? apply.all) {
                    value -= this.rateMods[mod];
                }
            }
            return value;
        }

        isDemanded() {
            return this.requestedQuantity > this.currentQuantity;
        }

        get income() {
            return this.calculateRateOfChange({buy: false, all: true});
        }

        get spareQuantity() {
            return this.currentQuantity - this.requestedQuantity;
        }

        get spareMaxQuantity() {
            return this.maxQuantity - this.requestedQuantity;
        }

        isUnlocked() {
            return this.instance?.display ?? false;
        }

        isRoutesUnlocked() {
            return this.isUnlocked() && (!game.global.race['artifical'] || this !== resources.Food) && ((game.global.race['banana'] && this === resources.Food) || (game.global.tech['trade'] && !game.global.race['terrifying']));
        }

        isManagedStorage() {
            return this.hasStorage() && this.autoStorageEnabled;
        }

        get atomicMass() {
            return game.atomic_mass[this.id] ?? 0;
        }

        isUseful() {
            /* This check always cause issues, i'll just disable it for now
            // Spending accumulated resources
            if (settings.autoStorage && settings.storageSafeReassign && !this.storeOverflow && this.currentQuantity > this.minStorage && this.currentQuantity > this.storageRequired &&
              ((this.currentCrates > 0 && this.maxQuantity - StorageManager.crateValue > this.storageRequired) ||
               (this.currentContainers > 0 && this.maxQuantity - StorageManager.containerValue > this.storageRequired))) {
                return false;
            }
            */
            return this.storageRatio < 0.99 || this.isDemanded() || this.rateMods['eject'] > 0 || this.rateMods['supply'] > 0 || (this.storeOverflow && this.currentQuantity < this.maxStorage);
        }

        getProduction(source, locArg) {
            let produced = 0;
            let labelFound = false;
            for (let [label, value] of Object.entries(game.breakdown.p[this._id] ?? {})) {
                if (value.indexOf("%") === -1) {
                    if (labelFound) {
                        break;
                    } else if (label === poly.loc(source, locArg)) {
                        labelFound = true;
                        produced += parseFloat(value) || 0;
                    }
                } else if (labelFound && this.isValidProductionLabel(label)) {
                    produced *= 1 + (parseFloat(value) || 0) / 100;
                }
            }
            return produced * state.globalProductionModifier;
        }

        isValidProductionLabel(label) {
            // Bug as of 1.3.11a: Space Syndicate is already applied to the displayed base value
            // The calculations are correct though
            // This can cause constant Iron flicker in Truepath because the script thinks
            // a worker is producing more than the constant smelter consumption.
            if (this._id === "Iron" && label === `ᄂ${poly.loc('space_syndicate')}`)
                return false;

            // Everything else is valid (at least for now)
            return true;
        }

        getBusyWorkers(workersSource, workersCount, locArg) {
            if (this.incomeAdusted) { // Don't reduce workers of same resource more than once per tick to avoid flickering
                return workersCount;
            }

            let newWorkers = 0;
            if (workersCount > 0) {
                let totalIncome = this.getProduction(workersSource, locArg);
                let resPerWorker = totalIncome / workersCount;
                let usedIncome = totalIncome - this.income;
                if (usedIncome > 0) {
                    newWorkers = Math.ceil(usedIncome / resPerWorker);
                }
            } else if (this.income < 0) {
                newWorkers = 1;
            }

            return newWorkers;
        }

        isCraftable() {
            return game.craftCost.hasOwnProperty(this.id);
        }

        hasStorage() {
            return this.instance?.stackable ?? false;
        }

        get tradeRouteQuantity() {
            return game.tradeRatio[this.id] || -1;
        }

        get storageRatio() {
            return this.maxQuantity > 0 ? this.currentQuantity / this.maxQuantity : 1;
        }

        isCapped() {
            return this.maxQuantity > 0 ? this.currentQuantity + (this.rateOfChange / ticksPerSecond()) >= this.maxQuantity : true;
        }

        get usefulRatio() {
            return this.maxQuantity > 0 && this.storageRequired > 0 ? this.currentQuantity / Math.min(this.maxQuantity, this.storageRequired) : 1;
        }

        get timeToFull() {
            if (this.storageRatio > 0.98) {
                return Number.MIN_SAFE_INTEGER; // Already full.
            }
            let totalRateOfCharge = this.income;
            if (totalRateOfCharge <= 0) {
                return Number.MAX_SAFE_INTEGER; // Won't ever fill with current rate.
            }
            return (this.maxQuantity - this.currentQuantity) / totalRateOfCharge;
        }

        get timeToRequired() {
            if (this.storageRatio > 0.98) {
                return Number.MIN_SAFE_INTEGER; // Already full.
            }
            if (this.storageRequired <= 1) {
                return 0;
            }
            let totalRateOfCharge = this.income;
            if (totalRateOfCharge <= 0) {
                return Number.MAX_SAFE_INTEGER; // Won't ever fill with current rate.
            }
            return (Math.min(this.maxQuantity, this.storageRequired) - this.currentQuantity) / totalRateOfCharge;
        }

        tryCraftX(count) {
            let vue = getVueById(this._vueBinding);
            if (vue === undefined) { return false; }

            KeyManager.set(false, false, false);
            vue.craft(this.id, count);
        }
    }

    class SoulGem extends Resource {
        updateData() {
            super.updateData();
            this.rateOfChange = state.soulGemPerHour / 3600;
        }
    }

    class Supply extends Resource {
        updateData() {
            if (!this.isUnlocked()) {
                return;
            }

            this.currentQuantity = game.global.portal.purifier.supply;
            this.maxQuantity = game.global.portal.purifier.sup_max;
            this.rateOfChange = game.global.portal.purifier.diff;
        }

        isUnlocked() {
            return game.global.portal.hasOwnProperty('purifier');
        }
    }

    class Power extends Resource {
        updateData() {
            if (!this.isUnlocked()) {
                return;
            }

            this.currentQuantity = game.global.city.power;
            if (haveTask("replicate")) {
                this.currentQuantity += game.global.race.replicator.pow;
            }
            this.rateOfChange = this.currentQuantity;

            this.maxQuantity = 0;
            if (game.global.race.powered) {
                this.maxQuantity += (resources.Population.maxQuantity - resources.Population.currentQuantity) * traitVal('powered', 0);
            }
            for (let building of Object.values(buildings)) {
                if (building.stateOffCount > 0) {
                    let missingAmount = building.stateOffCount;
                    if (building.autoMax < building.count && settings.masterScriptToggle && settings.autoPower && building.autoStateEnabled && settings.buildingsLimitPowered) {
                        missingAmount -= building.count - building.autoMax;
                    }

                    if (building === buildings.NeutronCitadel) {
                        this.maxQuantity += getCitadelConsumption(building.stateOnCount + missingAmount) - getCitadelConsumption(building.stateOnCount);
                    } else {
                        this.maxQuantity += missingAmount * building.powered;
                    }
                }
            }
        }

        get usefulRatio() { // Could be useful for satisfied check in override
            return this.currentQuantity >= this.maxQuantity ? 1 : 0;
        }

        isUnlocked() {
            return game.global.city.powered;
        }
    }

    class Support extends Resource {
        // This isn't really a resource but we're going to make a dummy one so that we can treat it like a resource
        constructor(name, id, region, inRegionId) {
            super(name, id);

            this._region = region;
            this._inRegionId = inRegionId;
        }

        updateData() {
            if (!this.isUnlocked()) {
                return;
            }

            this.maxQuantity = game.global[this._region][this.supportId].s_max;
            this.currentQuantity = game.global[this._region][this.supportId].support;
            this.rateOfChange = this.maxQuantity - this.currentQuantity;
        }

        get supportId() {
            return game.actions[this._region][this._inRegionId].info.support;
        }

        get storageRatio() {
            return this.maxQuantity > 0 ? (this.maxQuantity - this.currentQuantity) / this.maxQuantity : 1;
        }

        isUnlocked() {
            return game.global[this._region][this.supportId] !== undefined;
        }
    }

    class BeltSupport extends Support {
        // Unlike other supports this one takes in account available workers
        updateData() {
            if (!this.isUnlocked()) {
                return;
            }

            let maxStations = settings.autoPower && buildings.BeltSpaceStation.autoStateEnabled ? buildings.BeltSpaceStation.count : buildings.BeltSpaceStation.stateOnCount;
            let maxWorkers = settings.autoJobs && jobs.SpaceMiner.autoJobEnabled && jobs.SpaceMiner.isSmartEnabled ? state.maxSpaceMiners : jobs.SpaceMiner.count;
            this.maxQuantity = Math.min(maxStations * 3 * traitVal('high_pop', 0, 1), maxWorkers);
            this.currentQuantity = game.global[this._region][this.supportId].support;
            this.rateOfChange = this.maxQuantity - this.currentQuantity;
        }
    }

    class ElectrolysisSupport extends Support {
        updateData() {
            if (!this.isUnlocked()) {
                return;
            }

            this.maxQuantity = buildings.TitanElectrolysis.stateOnCount;
            this.currentQuantity = buildings.TitanHydrogen.stateOnCount;
            this.rateOfChange = this.maxQuantity - this.currentQuantity;
        }

        isUnlocked() {
            return game.global.race['truepath'] ? true : false;
        }
    }

    class WomlingsSupport extends Support {
        updateData() {
            if (!this.isUnlocked()) {
                return;
            }

            this.maxQuantity = buildings.TauRedWomlingVillage.stateOnCount * (haveTech("womling_pop", 2) ? 6 : 5);
            this.currentQuantity = buildings.TauRedWomlingFarm.stateOnCount * 2 + buildings.TauRedWomlingLab.stateOnCount + buildings.TauRedWomlingMine.stateOnCount * 6;
            this.rateOfChange = this.maxQuantity - this.currentQuantity; // - game.global.tauceti.overseer.injured
        }

        isUnlocked() {
            return haveTech('tau_red', 5) ? true : false;
        }
    }

    class PrestigeResource extends Resource {
        updateData() {
            this.currentQuantity = game.global.prestige[this.id].count;
            this.maxQuantity = Number.MAX_SAFE_INTEGER;
        }

        isUnlocked() {
            return true;
        }
    }

    class Population extends Resource {
        get id() {
            // The population node is special and its id will change to the race name
            return game.global.race.species;
        }
    }

    class Morale extends Resource {
        updateData() {
            this.currentQuantity = game.global.city.morale.current;
            this.maxQuantity = game.global.city.morale.cap;
            this.rateOfChange = game.global.city.morale.potential;
            this.incomeAdusted = false;
        }

        isUnlocked() {
            return true;
        }
    }

    class Thrall extends Resource {
        updateData() {
            if (!this.isUnlocked()) {
                return;
            }

            this.currentQuantity = 0;
            this.rateOfChange = 0;
            for (let i = 0; i < game.global.city.surfaceDwellers.length; i++) {
                this.currentQuantity += game.global.city.captive_housing[`race${i}`];
                this.rateOfChange += game.global.city.captive_housing[`jailrace${i}`];
            }
            this.currentQuantity += this.rateOfChange;
            this.maxQuantity = game.global.city.captive_housing.raceCap;
        }

        isUnlocked() {
            return game.global.city.captive_housing ? true : false;
        }
    }

    class ResourceProductionCost {
        constructor(resource, quantity, minRateOfChange) {
            this.resource = resource;
            this.quantity = quantity;
            this.minRateOfChange = minRateOfChange;
        }
    }

    class Action {
        constructor(name, tab, id, location, flags) {
            this.name = name;
            this._tab = tab;
            this._id = id;
            this._location = location;
            this.gameMax = Number.MAX_SAFE_INTEGER;
            this._vueBinding = this._tab + "-" + this.id;
            this.weighting = 0;
            this.extraDescription = "";
            this.consumption = [];
            this.cost = {};
            this.overridePowered = undefined;

            this.is = normalizeProperties(flags) ?? {};
        }

        get autoBuildEnabled() { return settings['bat' + this._vueBinding] }
        get autoStateEnabled() { return settings['bld_s_' + this._vueBinding] }
        get autoStateSmart() { return settings['bld_s2_' + this._vueBinding] }
        get priority() { return settingsRaw['bld_p_' + this._vueBinding] }
        get _weighting() { return settings['bld_w_' + this._vueBinding] }
        get _autoMax() { return settings['bld_m_' + this._vueBinding] }

        get definition() {
            if (this._location !== "") {
                return game.actions[this._tab][this._location][this._id];
            } else {
                return game.actions[this._tab][this._id];
            }
        }

        get instance() {
            return game.global[this._tab][this._id];
        }

        get id() {
            return this._id;
        }

        get title() {
            let def = this.definition;
            return def ? typeof def.title === 'function' ? def.title() : def.title : this.name;
        }

        get desc() {
            let def = this.definition;
            return def ? typeof def.desc === 'function' ? def.desc() : def.desc : this.name;
        }

        get vue() {
            return getVueById(this._vueBinding);
        }

        /* That's a right(ish) way to do, but compared to hardcoded numbers it's a performance tax for... nothing really, as i'll still need to manually declare a lot of things for each new building, and it's already declared for all existing ones. I'll put it on hold for now.
        get gameMax() {
            // queue_complete need an initialized instance to read a current count
            return this.instance && this.definition.queue_complete ? this.instance.count + this.definition.queue_complete() : Number.MAX_SAFE_INTEGER;
        }*/

        get autoMax() {
            // There is a game max. eg. world collider can only be built 1859 times
            return this._autoMax >= 0 && this._autoMax <= this.gameMax ? this._autoMax : this.gameMax;
        }

        isUnlocked() {
            if ((this._tab === "city" && !game.global.settings.showCity) ||
                (this._tab === "space" && (!game.global.settings.showSpace && !game.global.settings.showOuter)) ||
                (this._tab === "interstellar" && !game.global.settings.showDeep) ||
                (this._tab === "portal" && !game.global.settings.showPortal) ||
                (this._tab === "galaxy" && !game.global.settings.showGalactic) ||
                (this._tab === "tauceti" && !game.global.settings.showTau)) {
                return false;
            }
            return document.getElementById(this._vueBinding) !== null;
        }

        isSwitchable() {
            return this.definition.hasOwnProperty("powered") || this.definition.hasOwnProperty("switchable");
        }

        isMission() {
            return this.definition.hasOwnProperty("grant");
        }

        isComplete() {
            return haveTech(this.definition.grant[0], this.definition.grant[1]);
        }

        isSmartManaged() {
            return settings.autoPower && this.isUnlocked() && this.autoStateEnabled && this.autoStateSmart;
        }

        isAutoBuildable() {
            return this.isUnlocked() && this.autoBuildEnabled && this._weighting > 0 && this.count < this.autoMax;
        }

        // export function checkPowerRequirements(c_action) from actions.js
        checkPowerRequirements() {
            for (let [tech, value] of Object.entries(this.definition.power_reqs ?? {})) {
                if (!haveTech(tech, value)){
                    return false;
                }
            }
            return true;
        }

        get powered() {
            if (this.overridePowered !== undefined) {
                return this.overridePowered;
            }

            if (!this.definition.hasOwnProperty("powered") || !this.checkPowerRequirements()) {
                return 0;
            }

            return this.definition.powered();
        }

        updateResourceRequirements() {
            if (!this.isUnlocked()) {
                return;
            }

            this.cost = {};
            if (!this.definition.cost) {
                return;
            }

            let adjustedCosts = poly.adjustCosts(this.definition);
            for (let resourceName in adjustedCosts) {
                if (resources[resourceName]) {
                    let resourceAmount = Number(adjustedCosts[resourceName]());
                    if (resourceAmount > 0) {
                        this.cost[resourceName] = resourceAmount;
                    }
                }
            }
        }

        isAffordable(max = false) {
            return game.checkAffordable(this.definition, max);
        }

        // Whether the action is clickable is determined by whether it is unlocked, affordable and not a "permanently clickable" action
        isClickable() {
            return this.isUnlocked() && this.isAffordable() && this.count < this.gameMax;
        }

        // This is a "safe" click. It will only click if the container is currently clickable.
        // ie. it won't bypass the interface and click the node if it isn't clickable in the UI.
        click() {
            if (!this.isClickable()) {
                return false
            }

            let doMultiClick = this.is.multiSegmented && settings.buildingsUseMultiClick;
            let amountToBuild = 1;
            if (doMultiClick) {
                amountToBuild = this.gameMax - this.count;
                for (let res in this.cost) {
                    amountToBuild = Math.min(amountToBuild, Math.floor(resources[res].currentQuantity / this.cost[res]));
                }
                if (amountToBuild < 1) { // Game allow to spend more resources than available, going negative. If we're here - building is clickable, and we can afford at least one thing for sure.
                    amountToBuild = 1;
                }
            }

            for (let res in this.cost) {
                resources[res].currentQuantity -= this.cost[res] * amountToBuild;
            }

            // Don't log evolution actions and gathering actions
            if (game.global.race.species !== "protoplasm" && !logIgnore.includes(this.id)) {
                if (this.gameMax < Number.MAX_SAFE_INTEGER && this.count + amountToBuild < this.gameMax) {
                    GameLog.logSuccess("multi_construction", poly.loc('build_success', [`${this.title} (${this.count + amountToBuild})`]), ['queue', 'building_queue']);
                } else {
                    GameLog.logSuccess("construction", poly.loc('build_success', [this.title]), ['queue', 'building_queue']);
                }
            }

            KeyManager.set(doMultiClick, doMultiClick, doMultiClick);

            if (this.is.prestige) { logPrestige(); }

            // Hide active popper from action, so it won't rewrite it
            let popper = $('#popper');
            if (popper.length > 0 && popper.data('id').indexOf(this._vueBinding) === -1) {
                popper.attr('id', 'TotallyNotAPopper');

                this.vue.action();
                popper.attr('id', 'popper');
            } else {
                this.vue.action();
            }

            if (this.is.prestige) {
                state.goal = "GameOverMan";
            }

            return true;
        }

        addSupport(resource) {
            this.consumption.push(normalizeProperties({ resource: resource, rate: () => this.definition.support() * -1 }));
        }

        addResourceConsumption(resource, rate) {
            // TODO: Load fuel from definition, same as for support
            this.consumption.push(normalizeProperties({ resource: resource, rate: rate }));
        }

        getFuelRate(idx) {
            if (!this.consumption[idx]) {
                return 0;
            }

            let resource = this.consumption[idx].resource;
            let rate = this.consumption[idx].rate;
            if (this._tab === "space" && (resource === resources.Oil || resource === resources.Helium_3)) {
                rate = game.fuel_adjust(rate, true);
            }
            else if ((this._tab === "interstellar" || this._tab === "galaxy" || this._tab === "tauceti") && (resource === resources.Deuterium || resource === resources.Helium_3) && this !== buildings.AlphaFusion) {
                rate = game.int_fuel_adjust(rate);
            }
            return rate;
        }

        getMissingConsumption() {
            for (let j = 0; j < this.consumption.length; j++) {
                let resource = this.consumption[j].resource;
                if (resource instanceof Support) {
                    continue;
                }

                // Food fluctuate a lot, ignore it, assuming we always can get more
                if (resource === resources.Food && settings.autoJobs && (jobs.Farmer.autoJobEnabled || jobs.Hunter.autoJobEnabled)) {
                    continue;
                }

                // Now let's actually check it, bought resources excluded from rateOfChange, to prevent losing resources after switching routes
                let consumptionRate = this.getFuelRate(j);
                if (resource.storageRatio < 0.95 && consumptionRate > 0 && resource.calculateRateOfChange({buy: true}) < consumptionRate) {
                    return resource;
                }
            }
            return null;
        }

        getMissingSupport() {
            for (let j = 0; j < this.consumption.length; j++) {
                let resource = this.consumption[j].resource;

                // We're going to build Spire things with no support, to enable them later
                if (resource === resources.Spire_Support && this.autoStateSmart) {
                    continue;
                }
                // Tau Belt support can be overused
                if (resource === resources.Tau_Belt_Support) {
                    continue;
                }
                // Womlings facilities can run understaffed
                if (resource === resources.Womlings_Support && resource.rateOfChange > 0) {
                    continue;
                }

                let rate = this.consumption[j].rate;
                if (!(resource instanceof Support) || rate <= 0) {
                    continue;
                }

                // We don't have spare support for this
                if (resource.rateOfChange < rate) {
                    return resource;
                }
            }
            return null;
        }

        getUselessSupport() {
            // Starbase and Habitats are exceptions, they're always useful
            if (this === buildings.GatewayStarbase || this === buildings.AlphaHabitat ||
               (this === buildings.SpaceNavBeacon && game.global.race['orbit_decayed'])) {
                return null;
            }

            let uselessSupports = [];
            for (let j = 0; j < this.consumption.length; j++) {
                let resource = this.consumption[j].resource;
                let rate = this.consumption[j].rate;
                if (!(resource instanceof Support) || rate >= 0) {
                    continue;
                }
                let minSupport = resource === resources.Belt_Support ? (2 * traitVal('high_pop', 0, 1)) :
                    resource === resources.Gateway_Support ? 5 :
                    resource === resources.Womlings_Support ? 6 : 1;

                if (resource.rateOfChange >= minSupport) {
                    uselessSupports.push(resource);
                } else {
                    // If we have something useful - stop here, we care only about buildings with all supports useless
                    return null;
                }
            }
            return uselessSupports[0] ?? null;
        }

        get count() {
            if (this.isMission()) {
                return this.isComplete() ? 1 : 0;
            }

            if (!this.isUnlocked()) {
                return 0;
            }

            return this.instance?.count ?? 0;
        }

        hasState() {
            if (!this.isUnlocked()) {
                return false;
            }

            return (this.definition.powered && haveTech("high_tech", 2) && this.checkPowerRequirements()) || this.definition.switchable?.() || false;
        }

        get stateOnCount() {
            if (!this.hasState() || this.count < 1) {
                return 0;
            }

            return this.instance.on;
        }

        get stateOffCount() {
            if (!this.hasState() || this.count < 1) {
                return 0;
            }

            return this.instance.count - this.instance.on;
        }

        tryAdjustState(adjustCount) {
            if (adjustCount === 0 || !this.hasState()) {
                return false;
            }

            let vue = this.vue;

            if (adjustCount > 0) {
                for (let m of KeyManager.click(adjustCount)) {
                    vue.power_on();
                }
                return true;
            }
            if (adjustCount < 0) {
                for (let m of KeyManager.click(adjustCount * -1)) {
                    vue.power_off();
                }
                return true;
            }
        }
    }

    class CityAction extends Action {
        get instance() {
            return game.global.city[this._id];
        }
    }

    class Pillar extends Action {
        get count() {
            return this.isUnlocked() ? this.definition.count() : 0;
        }

        get stateOnCount() {
            return this.isUnlocked() ? this.definition.on() : 0;
        }

        isAffordable(max = false) {
            if (game.global.tech.pillars !== 1 || game.global.race.universe === 'micro') {
                return false;
            }
            return game.checkAffordable(this.definition, max);
        }
    }

    class ResourceAction extends Action {
        constructor(name, tab, id, location, res, flags) {
            super(name, tab, id, location, flags);

            this.resource = resources[res];
        }

        get count() {
            return this.resource.currentQuantity;
        }
    }

    class EvolutionAction extends Action {
        constructor(id) {
            super("", "evolution", id, "");
        }

        isUnlocked() {
            let node = document.getElementById(this._vueBinding);
            return node !== null && !node.classList.contains('is-hidden');
        }
    }

    class SpaceDock extends Action {
        isOptionsCached() {
            if (this.count < 1 || game.global.tech['genesis'] < 4) {
                // It doesn't have options yet so I guess all "none" of them are cached!
                // Also return true if we don't have the required tech level yet
                return true;
            }

            // If our tech is unlocked but we haven't cached the vue the the options aren't cached
            if (!buildings.GasSpaceDockProbe.isOptionsCached()
                || game.global.tech['genesis'] >= 5 && !buildings.GasSpaceDockShipSegment.isOptionsCached()
                || game.global.tech['genesis'] === 6 && !buildings.GasSpaceDockPrepForLaunch.isOptionsCached()
                || game.global.tech['genesis'] >= 7 && !buildings.GasSpaceDockLaunch.isOptionsCached()
                || game.global.tech['geck'] >= 1 && !buildings.GasSpaceDockGECK.isOptionsCached()) {
                return false;
            }

            return true;
        }

        cacheOptions() {
            if (this.count < 1 || WindowManager.isOpen()) {
                return false;
            }

            let optionsNode = document.querySelector("#space-star_dock .special");
            WindowManager.openModalWindowWithCallback(optionsNode, this.title, () => {
                buildings.GasSpaceDockProbe.cacheOptions();
                buildings.GasSpaceDockGECK.cacheOptions();
                buildings.GasSpaceDockShipSegment.cacheOptions();
                buildings.GasSpaceDockPrepForLaunch.cacheOptions();
                buildings.GasSpaceDockLaunch.cacheOptions();
            });
            return true;
        }
    }

    class ModalAction extends Action {
        constructor(...args) {
            super(...args);

            this._vue = undefined;
        }

        get vue() {
            return this._vue;
        }

        isOptionsCached() {
            return this._vue !== undefined;
        }

        cacheOptions() {
            this._vue = getVueById(this._vueBinding);
        }

        isUnlocked() {
            // All ModalActions belongs to starDock tab
            if (!game.global.settings.showSpace) {
                return false;
            }
            // We have to override this as there won't be an element unless the modal window is open
            return this._vue !== undefined;
        }
    }

    class Project extends Action {
        constructor(name, id) {
            super(name, "arpa", id, "");
            this._vueBinding = "arpa" + this.id;
            this.currentStep = 1;
        }

        get autoBuildEnabled() { return settings['arpa_' + this._id] }
        get priority() { return settingsRaw['arpa_p_' + this._id] }
        get _autoMax() { return settings['arpa_m_' + this._id] }
        get _weighting() { return settings['arpa_w_' + this._id] }

        updateResourceRequirements() {
            if (!this.isUnlocked()) {
                return;
            }

            this.cost = {};
            let maxStep = Math.min(100 - this.progress, state.triggerTargets.includes(this) ? 100 : settings.arpaStep);

            let adjustedCosts = poly.arpaAdjustCosts(this.definition.cost);
            for (let resourceName in adjustedCosts) {
                if (resources[resourceName]) {
                    let resourceAmount = Number(adjustedCosts[resourceName]());
                    if (resourceAmount > 0) {
                        this.cost[resourceName] = resourceAmount / 100;
                        maxStep = Math.min(maxStep, resources[resourceName].maxQuantity / this.cost[resourceName]);
                    }
                }
            }

            this.currentStep = Math.max(Math.floor(maxStep), 1);
            if (this.currentStep > 1) {
                for (let res in this.cost) {
                    this.cost[res] *= this.currentStep;
                }
            }
        }

        get count() {
            return this.instance?.rank ?? 0;
        }

        get progress() {
            return this.instance?.complete ?? 0;
        }

        isAffordable(max = false) {
            // We can't use exposed checkAffordable with projects, so let's write it. Luckily project need only basic resources
            let check = max ? "maxQuantity" : "currentQuantity";
            for (let res in this.cost) {
                if (resources[res][check] < this.cost[res]) {
                    return false;
                }
            }
            return true;
        }

        isClickable() {
            return this.isUnlocked() && this.isAffordable(false);
        }

        click() {
            if (!this.isClickable()) {
                return false
            }

            for (let res in this.cost) {
                resources[res].currentQuantity -= this.cost[res];
            }

            if (this.progress + this.currentStep < 100) {
                GameLog.logSuccess("arpa", poly.loc('build_success', [`${this.title} (${this.progress + this.currentStep}%)`]), ['queue', 'building_queue']);
            } else {
                GameLog.logSuccess("construction", poly.loc('build_success', [this.title]), ['queue', 'building_queue']);
                if (this.id === "syphon" && this.count == 79) {
                    logPrestige();
                }
            }

            KeyManager.set(false, false, false);
            getVueById(this._vueBinding).build(this.id, this.currentStep);
            return true;
        }
    }

    class Technology {
        constructor(id) {
            this._id = id;

            this._vueBinding = "tech-" + id;

            this.cost = {};
        }

        get id() {
            return this._id;
        }

        isUnlocked() {
            // vue of researched techs still can be found in #oldTech
            return document.querySelector("#" + this._vueBinding + " > .button:not(.precog)") !== null && getVueById(this._vueBinding) !== undefined;
        }

        get definition() {
            return game.actions.tech[this._id];
        }

        get title() {
            let def = this.definition;
            let title = typeof def.title === 'function' ? def.title() : def.title;
            if (def.path && def.path.includes('truepath') && !def.path.includes('standard')) {
                title += ` (${game.loc('evo_challenge_truepath')})`;
            }
            return title;
        }

        get name() {
            return this.title;
        }

        isAffordable(max = false) {
            return game.checkAffordable(this.definition, max);
        }

        // Whether the action is clickable is determined by whether it is unlocked, affordable and not a "permanently clickable" action
        isClickable() {
            return this.isUnlocked() && this.isAffordable();
        }

        // This is a "safe" click. It will only click if the container is currently clickable.
        // ie. it won't bypass the interface and click the node if it isn't clickable in the UI.
        click() {
            if (!this.isClickable()) {
                return false
            }

            for (let res in this.cost) {
                resources[res].currentQuantity -= this.cost[res];
            }

            getVueById(this._vueBinding).action();

            let def = this.definition;
            let title = typeof def.title === 'function' ? def.title() : def.title;
            GameLog.logSuccess("research", poly.loc('research_success', [title]), ['queue', 'research_queue']);
            return true;
        }

        isResearched() {
            return document.querySelector("#tech-" + this.id + " .oldTech") !== null;
        }

        updateResourceRequirements() {
            if (!this.isUnlocked()) {
                return;
            }

            this.cost = {};
            if (!this.definition.cost) {
                return;
            }

            let adjustedCosts = poly.adjustCosts(this.definition);
            for (let resourceName in adjustedCosts) {
                if (resources[resourceName]) {
                    let resourceAmount = Number(adjustedCosts[resourceName]());
                    if (resourceAmount > 0) {
                        this.cost[resourceName] = resourceAmount;
                    }
                }
            }
        }
    }

    class Race {
        constructor(id) {
            this.id = id;
            this.evolutionTree = [];
        }

        get name() {
            return game.races[this.id].name ?? "Custom";
        }

        get desc() {
            let nameRef = game.races[this.id].desc;
            return typeof nameRef === "function" ? nameRef() :
                   typeof nameRef === "string" ? nameRef :
                   "Custom"; // Nonexistent custom
        }

        get genus() {
            return game.races[this.id].type;
        }

        getWeighting() {
            // Locked races always have zero weighting
            let habitability = this.getHabitability();
            if (habitability < (settings.evolutionAutoUnbound ? 0.8 : 1)) {
                return -1;
            }

            const noGenusRace = ["custom", "junker", "sludge"];
            const greatnessReset = ["bioseed", "ascension", "terraform", "matrix", "retire", "eden"];
            const midTierReset = ["bioseed", "cataclysm", "whitehole", "vacuum", "terraform"];
            const highTierReset = ["ascension", "demonic"];
            const bestForMid = ["human", "cath", "capybara", "gnome", "cyclops", "gecko", "dracnid", "entish", "shroomi", "antid", "sharkin", "dryad", "salamander", "yeti", "kamel", "imp", "unicorn", "synth", "shoggoth"];
            const bestForHigh = ["human", "cath", "capybara", "gnome", "cyclops", "gecko", "dracnid", "entish", "shroomi", "scorpid", "sharkin", "dryad", "salamander", "wendigo", "kamel", "balorg", "unicorn", "nano", "ghast"];
            // TODO: Races for TP resets, with armor and such

            let weighting = 0;
            let starLevel = getStarLevel(settings);
            const checkAchievement = (baseWeight, id) => {
                weighting += baseWeight * Math.max(0, starLevel - getAchievementStar(id));
                if (game.global.race.universe !== "micro" && game.global.race.universe !== "standard") {
                    weighting += baseWeight * Math.max(0, starLevel - getAchievementStar(id, "standard"));
                }
            }

            // Check pillar
            if ((settings.prestigeType === "ascension" && settings.prestigeAscensionPillar) || settings.prestigeType === "demonic") {
                let speciesPillarLevel = game.global.pillars[this.id] ?? 0;
                let canPillar = !speciesPillarLevel && resources.Harmony.currentQuantity >= 1 && game.global.race.universe !== 'micro';
                let canUpgrade = speciesPillarLevel && speciesPillarLevel < starLevel;
                if (canPillar || canUpgrade) {
                    weighting += 1000 * Math.max(0, starLevel - speciesPillarLevel);
                    // Check genus pillar for Enlightenment
                    if (!noGenusRace.includes(this.id)) {
                        let genusPillar = Math.max(...Object.values(races)
                          .filter(r => r.genus === this.genus && !noGenusRace.includes(r.id))
                          .map(r => (game.global.pillars[r.id] ?? 0)));
                        weighting += 10000 * Math.max(0, starLevel - genusPillar);
                    }
                }
            }

            // Check greatness\extinction achievement
            if (greatnessReset.includes(settings.prestigeType)) {
                checkAchievement(100, "genus_" + this.genus);
            } else if (this.id !== "sludge" || settings.prestigeType !== "mad") {
                checkAchievement(100, "extinct_" + this.id);
            }

            // Blood War
            if (this.genus === "demonic" && settings.prestigeType !== "mad" && settings.prestigeType !== "bioseed") {
                checkAchievement(50, "blood_war");
            }

            // Sharks with Lasers
            if (this.id === "sharkin" && settings.prestigeType !== "mad") {
                checkAchievement(50, "laser_shark");
            }

            // Macro Universe and Arquillian Galaxy
            if (game.global.race.universe === "micro" && settings.prestigeType === "bioseed") {
                let smallRace = (this.genus === "small" || game.races[this.id].traits.compact);
                checkAchievement(50, smallRace ? "macro" : "marble");
            }

            // You Shall Pass
            if (this.id === "balorg" && game.global.race.universe === "magic" && settings.prestigeType === "vacuum") {
                checkAchievement(50, "pass");
            }

            // Madagascar Tree, Godwin's law, Infested Terrans - Achievement race
            for (let set of fanatAchievements) {
                if (this.id === set.race && game.global.race.gods === set.god) {
                    checkAchievement(150, set.achieve);
                }
            }

            // Increase weight for suited conditional races with achievements
            if (weighting > 0 && habitability === 1 && this.getCondition() !== '' && this.id !== "junker" && this.id !== "sludge") {
                weighting += 500;
            }

            // Increases weight of stringest races of genus
            if ((midTierReset.includes(settings.prestigeType) && bestForMid.includes(this.id)) ||
                (highTierReset.includes(settings.prestigeType) && bestForHigh.includes(this.id))) {
                weighting += 1;
            }

            // Same race for Second Evolution
            if (this.id === game.global.race.gods) {
                checkAchievement(10, "second_evolution");
            }

            // Madagascar Tree, Godwin's law, Infested Terrans - God race
            // This races shouldn't benefit from suited planet, to avoid prep -> prep loops
            for (let set of fanatAchievements) {
                if (this.id === set.god) {
                    checkAchievement(5, set.achieve);
                }
            }

            // Feats, lowest weight - go for them only if there's nothing better
            if (game.global.race.universe !== "micro") {
                const checkFeat = (id) => {
                    weighting += 1 * Math.max(0, starLevel - (game.global.stats.feat[id] ?? 0));
                }

                // Take no advice, Ill Advised
                if (game.global.city.biome === "hellscape" && this.genus !== "demonic") {
                    switch (settings.prestigeType) {
                        case "mad":
                        case "cataclysm":
                            checkFeat("take_no_advice");
                            break;
                        case "bioseed":
                            checkFeat("ill_advised");
                            break;
                    }
                }

                // Organ Harvester, The Misery, Garbage Pie
                if (this.id === "junker") {
                    switch (settings.prestigeType) {
                        case "bioseed":
                            checkFeat("organ_harvester");
                            break;
                        case "ascension":
                        case "demonic":
                            checkFeat("garbage_pie");
                        case "terraform":
                        case "whitehole":
                        case "vacuum":
                        case "apocalypse":
                            checkFeat("the_misery");
                            break;
                    }
                }

                // Nephilim
                if (settings.prestigeType === "whitehole" && game.global.race.universe === "evil" && this.genus === "angelic") {
                    checkFeat("nephilim");
                }

                // Twisted
                if (settings.prestigeType === "demonic" && this.genus === "angelic") {
                    checkFeat("twisted");
                }

                // Digital Ascension
                if (settings.prestigeType === "ascension" && settings.challenge_emfield && this.genus === "artifical" && this.id !== "custom") {
                    checkFeat("digital_ascension");
                }

                // Slime Lord
                if (settings.prestigeType === "demonic" && this.id === "sludge") {
                    checkFeat("slime_lord");
                }
            }

            // Ignore Valdi on low star, and decrease weight on any other star
            if (this.id === "junker" || this.id === "sludge") {
                weighting *= starLevel < 5 ? 0 : 0.01;
            }

            // Scale down weight of unsuited races
            weighting *= habitability;

            return weighting;
        }

        getHabitability() {
            if (this.id === "junker") {
                return game.global.genes.challenge ? 1 : 0;
            }
            if (this.id === "sludge") {
                return ((game.global.stats.achieve['ascended'] || game.global.stats.achieve['corrupted']) && game.global.stats.achieve['extinct_junker']) ? 1 : 0;
            }

            let unboundMod = game.global.blood.unbound >= 4 ? 0.95 :
                             game.global.blood.unbound >= 2 ? 0.9 :
                             game.global.blood.unbound >= 1 ? 0.8 : 0;
            let shadowMod = game.global.blood.unbound >= 3 ? unboundMod : 0;

            switch (this.genus) {
                case "aquatic":
                    return ['swamp','oceanic'].includes(game.global.city.biome) ? 1 : unboundMod;
                case "fey":
                    return ['forest','swamp','taiga'].includes(game.global.city.biome) ? 1 : unboundMod;
                case "sand":
                    return ['ashland','desert'].includes(game.global.city.biome) ? 1 : unboundMod;
                case "heat":
                    return ['ashland','volcanic'].includes(game.global.city.biome) ? 1 : unboundMod;
                case "polar":
                    return ['tundra','taiga'].includes(game.global.city.biome) ? 1 : unboundMod;
                case "demonic":
                    return game.global.city.biome === 'hellscape' ? 1 : shadowMod;
                case "angelic":
                    return game.global.city.biome === 'eden' ? 1 : shadowMod;
                case "synthetic":
                    return game.global.stats.achieve['obsolete']?.l >= 5 ? 1 : 0;
                case "eldritch":
                    return game.global.stats.achieve['nightmare']?.mg ? 1 : 0;
                case undefined: // Nonexistent custom
                    return 0;
                default:
                    return 1;
            }
        }

        getCondition() {
            if (this.id === "junker") {
                return "Genetic Dead End unlocked";
            }
            if (this.id === "sludge") {
                return "Failed Experiment unlocked";
            }

            switch (this.genus) {
                case "aquatic":
                    return "Oceanic or Swamp planet";
                case "fey":
                    return "Forest, Swamp or Taiga planet";
                case "sand":
                    return "Ashland or Desert planet";
                case "heat":
                    return "Ashland or Volcanic planet";
                case "polar":
                    return "Tundra or Taiga planet";
                case "demonic":
                    return "Hellscape planet";
                case "angelic":
                    return "Eden planet";
                case "synthetic":
                    return game.loc('wiki_achieve_obsolete');
                case "eldritch":
                    return game.loc('wiki_achieve_nightmare');
                case undefined: // Nonexistent custom
                    return game.loc('wiki_achieve_ascended');
                default:
                    return "";
            }
        }
    }

    class Trigger {
        constructor(seq, priority, requirementType, requirementId, requirementCount, actionType, actionId, actionCount) {
            this.seq = seq;
            this.priority = priority;

            this.requirementType = requirementType;
            this.requirementId = requirementId;
            this.requirementCount = requirementCount;

            this.actionType = actionType;
            this.actionId = actionId;
            this.actionCount = actionCount;

            this.complete = false;
        }

        cost() {
            if (this.actionType === "research") {
                return techIds[this.actionId].definition.cost;
            }
            if (this.actionType === "build") {
                return buildingIds[this.actionId].definition.cost;
            }
            if (this.actionType === "arpa") {
                return arpaIds[this.actionId].definition.cost;
            }
            return {};
        }

        isActionPossible() {
            // check against MAX as we want to know if it is possible...
            let obj = null;
            if (this.actionType === "research") {
                obj = techIds[this.actionId];
            }
            if (this.actionType === "build") {
                obj = buildingIds[this.actionId];
            }
            if (this.actionType === "arpa") {
                obj = arpaIds[this.actionId];
            }
            return obj && obj.isUnlocked() && obj.isAffordable(true);
        }

        updateComplete() {
            if (this.complete) {
                return false;
            }

            if (this.actionType === "research" && techIds[this.actionId].isResearched()) {
                this.complete = true;
                return true;
            }
            if (this.actionType === "build" && buildingIds[this.actionId].count >= this.actionCount) {
                this.complete = true;
                return true;
            }
            if (this.actionType === "arpa" && arpaIds[this.actionId].count >= this.actionCount) {
                this.complete = true;
                return true;
            }
            // HACK: Consider "build Space Dock" trigger complete when not in Bioseed and the Space Dock is buildable.
            // Very ugly hack.
            if (this.actionType === "build" && settings.prestigeType !== "bioseed" && buildingIds[this.actionId] === buildings.GasSpaceDock && this.isActionPossible()) {
                this.complete = true;
                return true;
            }
            return false;
        }

        areRequirementsMet() {
            if (this.requirementType === "unlocked" && techIds[this.requirementId].isUnlocked()) {
                return true;
            }
            if (this.requirementType === "researched" && techIds[this.requirementId].isResearched()) {
                return true;
            }
            if (this.requirementType === "built" && buildingIds[this.requirementId].count >= this.requirementCount) {
                return true;
            }
            if (this.requirementType === "chain" && (this.priority < 1 || TriggerManager.priorityList[this.priority - 1]?.complete)) {
                return true;
            }
            return false;
        }

        updateRequirementType(requirementType) {
            if (requirementType === this.requirementType) {
                return;
            }

            let oldType = this.requirementType;
            this.requirementType = requirementType;
            this.complete = false;

            if ((this.requirementType === "unlocked" || this.requirementType === "researched") &&
                (oldType === "unlocked" || oldType === "researched")) {
                return; // Both researches, old ID is still valid, and preserved.
            }
            if (this.requirementType === "unlocked" || this.requirementType === "researched") {
                this.requirementId = "tech-club";
                this.requirementCount = 0;
                return;
            }
            if (this.requirementType === "built") {
                this.requirementId = "city-basic_housing";
                this.requirementCount = 1;
                return;
            }
            if (this.requirementType === "chain") {
                this.requirementId = "";
                this.requirementCount = 0;
                return;
            }
        }

        updateRequirementId(requirementId) {
            if (requirementId === this.requirementId) {
                return;
            }

            this.requirementId = requirementId;
            this.complete = false;
        }

        updateRequirementCount(requirementCount) {
            if (requirementCount === this.requirementCount) {
                return;
            }

            this.requirementCount = requirementCount;
            this.complete = false;
        }

        updateActionType(actionType) {
            if (actionType === this.actionType) {
                return;
            }

            this.actionType = actionType;
            this.complete = false;

            if (this.actionType === "research") {
                this.actionId = "tech-club";
                this.actionCount = 0;
                return;
            }
            if (this.actionType === "build") {
                this.actionId = "city-basic_housing";
                this.actionCount = 1;
                return;
            }
            if (this.actionType === "arpa") {
                this.actionId = "arpalhc";
                this.actionCount = 1;
                return;
            }
        }

        updateActionId(actionId) {
            if (actionId === this.actionId) {
                return;
            }

            this.actionId = actionId;
            this.complete = false;
        }

        updateActionCount(actionCount) {
            if (actionCount === this.actionCount) {
                return;
            }

            this.actionCount = actionCount;
            this.complete = false;
        }
    }

    class MinorTrait {
        constructor(traitName) {
            this.traitName = traitName;
        }

        get enabled() { return settings['mTrait_' + this.traitName] }
        get priority() { return settingsRaw['mTrait_p_' + this.traitName] }
        get weighting() { return settings['mTrait_w_' + this.traitName] }

        isUnlocked() {
            return game.global.settings.mtorder.includes(this.traitName);
        }

        geneCount() {
            return game.global.race.minor[this.traitName] ?? 0;
        }

        phageCount() {
            return game.global.genes.minor[this.traitName] ?? 0;
        }

        totalCount() {
            return game.global.race[this.traitName] ?? 0;
        }

        geneCost() {
            return this.traitName === 'mastery' ? Fibonacci(this.geneCount()) * 5 : Fibonacci(this.geneCount());
        }
    }

    class MutableTrait {
        constructor(traitName) {
            this.traitName = traitName;
            this.baseCost = Math.abs(game.traits[traitName].val);
            this.isPositive = game.traits[traitName].val >= 0;
        }

        get gainEnabled() { return settings["mutableTrait_gain_" + this.traitName] }
        get purgeEnabled() { return settings["mutableTrait_purge_" + this.traitName] }
        get resetEnabled() { return settings["mutableTrait_reset_" + this.traitName] }
        get priority() { return settingsRaw["mutableTrait_p_" + this.traitName] }

        get name(){
            return game.loc("trait_" + this.traitName + "_name");
        }

        canGain() {
            return this.gainEnabled && !this.purgeEnabled && this.canMutate("gain")
              && game.global.race[this.traitName] === undefined
              && !conflictingTraits.some((set) => (set[0] === this.traitName && game.global.race[set[1]] !== undefined)
                                               || (set[1] === this.traitName && game.global.race[set[0]] !== undefined));
        }

        canPurge() {
            return this.purgeEnabled && !this.gainEnabled && this.canMutate("purge")
              && game.global.race[this.traitName] !== undefined
              && !(game.global.race.species === "sludge" && this.traitName === "ooze")
              && !(game.global.race.ss_traits?.includes(this.traitName))
              && !(game.global.race.iTraits?.hasOwnProperty(this.traitName));
        }

        canMutate(action) {
            let currentPlasmids = resources[game.global.race.universe === "antimatter" ? "Antiplasmid" : "Plasmid"].currentQuantity;
            return currentPlasmids - this.mutationCost(action) >= MutableTraitManager.minimumPlasmidsToPreserve
              && !(game.global.race.species === "sludge" && game.global.race["modified"]);
        }

        mutationCost(action) {
            let mult = mutationCostMultipliers[game.global.race.species]?.[action] ?? 1;
            return this.baseCost * 5 * mult;
        }
    }

    class MajorTrait extends MutableTrait {
        constructor(traitName) {
            super(traitName);
            this.type = "major";
            let ownerRace = Object.entries(game.races)
              .filter(([id, race]) => id !== "custom" && race.traits[traitName] !== undefined)
              .map(([id, race]) => ({id: id, genus: race.type}))[0] ?? {};
            this.source = ownerRace.id ?? specialRaceTraits[traitName] ?? "";
            this.racesThatCanGain = (Object.entries(game.races)
              .filter(([id, race]) => race.type === ownerRace.genus)
              .map(([id, race]) => id))
              .flat();
            this.genus = this.source === 'reindeer' ? 'herbivore' : ownerRace.genus;
        }

        isGainable() {
            return this.traitName !== "frail" && this.traitName !== "ooze";
        }

        canGain() {
            return super.canGain()
              && game.global.genes["mutation"] >= 3
              && this.racesThatCanGain.includes(game.global.race.species);
        }

        canPurge() {
            return super.canPurge()
              && game.global.genes["mutation"] >= 1;
        }
    }

    class GenusTrait extends MutableTrait {
        constructor(traitName) {
            super(traitName);
            this.type = "genus";
            let genus = Object.entries(poly.genus_traits)
              .filter(([id, traits]) => traits[traitName] !== undefined)
              .map(([id, traits]) => id);
            this.source = genus[0] ?? specialRaceTraits[traitName] ?? "";
            this.genus = this.source;
        }

        isGainable() {
            return false;
        }

        canGain() {
            return false;
        }

        canPurge() {
            return super.canPurge()
              && game.global.genes["mutation"] >= 2;
        }
    }

    // Script constants

    // Fibonacci numbers starting from "5"
    const Fibonacci = ((m) => (n) => m[n] ?? (m[n] = Fibonacci(n-1) + Fibonacci(n-2)))([5,8]);

    const numberSuffix = {
        K: 1000,
        M: 1000000,
        G: 1000000000,
        T: 1000000000000,
        P: 1000000000000000,
        E: 1000000000000000000,
        Z: 1000000000000000000000,
        Y: 1000000000000000000000000,
    }

    const universes = ['standard','heavy','antimatter','evil','micro','magic'];

    // Biomes, traits and geologies in natural order
    const biomeList = ['grassland', 'oceanic', 'forest', 'desert', 'volcanic', 'tundra', 'savanna', 'swamp', 'taiga', 'ashland', 'hellscape', 'eden'];
    const traitList = ['none', 'toxic', 'mellow', 'rage', 'stormy', 'ozone', 'magnetic', 'trashed', 'elliptical', 'flare', 'dense', 'unstable', 'permafrost', 'retrograde'];
    const extraList = ['Achievement', 'Orbit', 'Copper', 'Iron', 'Aluminium', 'Coal', 'Oil', 'Titanium', 'Uranium', 'Iridium'];

    // Biomes and traits sorted by habitability
    const planetBiomes = ["eden", "ashland", "volcanic", "taiga", "tundra", "swamp", "oceanic", "forest", "savanna", "grassland", "desert", "hellscape"];
    const planetTraits = ["elliptical", "magnetic", "permafrost", "rage", "retrograde", "none", "stormy", "toxic", "trashed", "dense", "unstable", "ozone", "mellow", "flare"];
    const planetBiomeGenus = {hellscape: "demonic", eden: "angelic", oceanic: "aquatic", forest: "fey", desert: "sand", volcanic: "heat", tundra: "polar"};
    const fanatAchievements = [{god: 'sharkin', race: 'entish', achieve: 'madagascar_tree'},
                               {god: 'sporgar', race: 'human', achieve: 'infested'},
                               {god: 'shroomi', race: 'troll', achieve: 'godwin'}];

    const challenges = [
        [{id:"plasmid", trait:"no_plasmid"},
         {id:"mastery", trait:"weak_mastery"},
         {id:"nerfed", trait:"nerfed"}],
        [{id:"crispr", trait:"no_crispr"},
         {id:"badgenes", trait:"badgenes"}],
        [{id:"trade", trait:"no_trade"}],
        [{id:"craft", trait:"no_craft"}],
        [{id:"joyless", trait:"joyless"}],
        [{id:"steelen", trait:"steelen"}],
        [{id:"decay", trait:"decay"}],
        [{id:"emfield", trait:"emfield"}],
        [{id:"inflation", trait:"inflation"}],
        [{id:"sludge", trait:"sludge"}],
        [{id:"orbit_decay", trait:"orbit_decay"}],
        //[{id:"nonstandard", trait:"nonstandard"}],
        [{id:"gravity_well", trait:"gravity_well"}],
        [{id:"witch_hunter", trait:"witch_hunter"}],
        //[{id:"warlord", trait:"warlord"}],
        //[{id:"storage_wars", trait:"storage_wars"}],
        [{id:"junker", trait:"junker"}],
        [{id:"cataclysm", trait:"cataclysm"}],
        [{id:"banana", trait:"banana"}],
        [{id:"truepath", trait:"truepath"}],
        [{id:"lone_survivor", trait:"lone_survivor"}],
    ];
    const governors = ["soldier", "criminal", "entrepreneur", "educator", "spiritual", "bluecollar", "noble", "media", "sports", "bureaucrat"];
    const evolutionSettingsToStore = ["userEvolutionTarget", "prestigeType", ...challenges.map(c => "challenge_" + c[0].id)];
    const logIgnore = ["food", "lumber", "stone", "chrysotile", "slaughter", "s_alter", "slave_market", "horseshoe", "assembly", "cloning_facility"];
    const galaxyRegions = ["gxy_stargate", "gxy_gateway", "gxy_gorddon", "gxy_alien1", "gxy_alien2", "gxy_chthonian"];
    const settingsSections = ["toggle", "general", "prestige", "evolution", "research", "market", "storage", "production", "war", "hell", "fleet", "job", "building", "project", "government", "logging", "trait", "weighting", "ejector", "planet", "mech", "magic"];
    const mutationCostMultipliers = {sludge: {gain: 2, purge: 10}, custom: {gain: 10, purge: 10}};
    const specialRaceTraits = {beast_of_burden: "reindeer", photosynth: "plant"};
    const conflictingTraits = [["dumb", "smart"]];
    const replicableResources = ['Food', 'Lumber', 'Chrysotile', 'Stone', 'Crystal', 'Furs', 'Copper', 'Iron', 'Aluminium', 'Cement', 'Coal', 'Oil', 'Uranium', 'Steel', 'Titanium', 'Alloy', 'Polymer', 'Iridium', 'Helium_3', 'Deuterium', 'Neutronium', 'Adamantite', 'Infernite', 'Elerium', 'Nano_Tube', 'Graphene', 'Stanene', 'Bolognium', 'Unobtainium', 'Vitreloy', 'Orichalcum', 'Water', 'Plywood', 'Brick', 'Wrought_Iron', 'Sheet_Metal', 'Mythril', 'Aerogel', 'Nanoweave', 'Scarletite', 'Quantium'];

    // Lookup tables, will be filled on init
    var techIds = {};
    var buildingIds = {};
    var arpaIds = {};
    var jobIds = {};
    var evolutions = {};
    var imitations = {};
    var races = {};
    var craftablesList = [];
    var foundryList = [];

    // State variables
    var state = {
        forcedUpdate: false,
        gameTicked: false,
        scriptTick: 1,
        multiplierTick: 0,
        buildingToggles: 0,
        evolutionAttempts: 0,
        tabHash: 0,

        lastWasteful: null,
        lastHighPop: null,
        lastFlier: null,
        lastPopulationCount: 0,
        lastFarmerCount: 0,
        astroSign: null,

        evoCheckNeeded: true,
        warnDebug: true,
        warnPreload: true,

        // We need to keep them separated, as we *don't* want to click on queue targets. Game will handle that. We're just managing resources for them.
        queuedTargets: [],
        queuedTargetsAll: [],
        triggerTargets: [],
        unlockedTechs: [],
        unlockedBuildings: [],
        conflictTargets: [],

        maxSpaceMiners: Number.MAX_SAFE_INTEGER,
        globalProductionModifier: 1,
        moneyIncomes: [],
        moneyMedian: 0,
        soulGemIncomes: [{sec: 0, gems: 0}],
        soulGemPerHour: 0,
        soulGemLast: Number.MAX_SAFE_INTEGER,

        knowledgeRequiredByTechs: 0,

        goal: "Standard",

        missionBuildingList: [],
        tooltips: {},
        filterRegExp: null,
        evolutionTarget: null,
    };

    // Class instances
    var resources = { // Resources order follow game order, and used to initialize priorities
        // Evolution resources
        RNA: new Resource("RNA", "RNA"),
        DNA: new Resource("DNA", "DNA"),

        // Base resources
        Money: new Resource("Money", "Money"),
        Population: new Population("Population", "Population"), // We can't store the full elementId because we don't know the name of the population node until later
        Slave: new Resource("Slave", "Slave"),
        Mana: new Resource("Mana", "Mana"),
        Energy: new Resource("Energy", "Energy"),
        Sus: new Resource("Suspicion", "Sus"),
        Knowledge: new Resource("Knowledge", "Knowledge"),
        Zen: new Resource("Zen", "Zen"),
        Crates: new Resource("Crates", "Crates"),
        Containers: new Resource("Containers", "Containers"),

        // Basic resources (can trade for these)
        Food: new Resource("Food", "Food", {tradable: true}),
        Lumber: new Resource("Lumber", "Lumber", {tradable: true}),
        Chrysotile: new Resource("Chrysotile", "Chrysotile", {tradable: true}),
        Stone: new Resource("Stone", "Stone", {tradable: true}),
        Crystal: new Resource("Crystal", "Crystal", {tradable: true}),
        Furs: new Resource("Furs", "Furs", {tradable: true}),
        Copper: new Resource("Copper", "Copper", {tradable: true}),
        Iron: new Resource("Iron", "Iron", {tradable: true}),
        Aluminium: new Resource("Aluminium", "Aluminium", {tradable: true}),
        Cement: new Resource("Cement", "Cement", {tradable: true}),
        Coal: new Resource("Coal", "Coal", {tradable: true}),
        Oil: new Resource("Oil", "Oil", {tradable: true}),
        Uranium: new Resource("Uranium", "Uranium", {tradable: true}),
        Steel: new Resource("Steel", "Steel", {tradable: true}),
        Titanium: new Resource("Titanium", "Titanium", {tradable: true}),
        Alloy: new Resource("Alloy", "Alloy", {tradable: true}),
        Polymer: new Resource("Polymer", "Polymer", {tradable: true}),
        Iridium: new Resource("Iridium", "Iridium", {tradable: true}),
        Helium_3: new Resource("Helium-3", "Helium_3", {tradable: true}),

        // Advanced resources
        Water: new Resource("Water", "Water"),
        Deuterium: new Resource("Deuterium", "Deuterium"),
        Neutronium: new Resource("Neutronium", "Neutronium"),
        Adamantite: new Resource("Adamantite", "Adamantite"),
        Infernite: new Resource("Infernite", "Infernite"),
        Elerium: new Resource("Elerium", "Elerium"),
        Nano_Tube: new Resource("Nano Tube", "Nano_Tube"),
        Graphene: new Resource("Graphene", "Graphene"),
        Stanene: new Resource("Stanene", "Stanene"),
        Bolognium: new Resource("Bolognium", "Bolognium"),
        Vitreloy: new Resource("Vitreloy", "Vitreloy"),
        Orichalcum: new Resource("Orichalcum", "Orichalcum"),
        Unobtainium: new Resource("Unobtainium", "Unobtainium"),
        Materials: new Resource("Materials", "Materials"),

        Horseshoe: new Resource("Horseshoe", "Horseshoe"),
        Nanite: new Resource("Nanite", "Nanite"),
        Genes: new Resource("Genes", "Genes"),
        Soul_Gem: new SoulGem("Soul Gem", "Soul_Gem"),

        // Craftable resources
        Plywood: new Resource("Plywood", "Plywood"),
        Brick: new Resource("Brick", "Brick"),
        Wrought_Iron: new Resource("Wrought Iron", "Wrought_Iron"),
        Sheet_Metal: new Resource("Sheet Metal", "Sheet_Metal"),
        Mythril: new Resource("Mythril", "Mythril"),
        Aerogel: new Resource("Aerogel", "Aerogel"),
        Nanoweave: new Resource("Nanoweave", "Nanoweave"),
        Scarletite: new Resource("Scarletite", "Scarletite"),
        Quantium: new Resource("Quantium", "Quantium"),

        // Special resources
        Corrupt_Gem: new Resource("Corrupt Gem", "Corrupt_Gem"),
        Codex: new Resource("Codex", "Codex"),
        Cipher: new Resource("Encrypted Data", "Cipher"),
        Demonic_Essence: new Resource("Demonic Essence", "Demonic_Essence"),

        // Prestige resources
        Blood_Stone: new PrestigeResource("Blood Stone", "Blood_Stone"),
        Artifact: new PrestigeResource("Artifact", "Artifact"),
        Plasmid: new PrestigeResource("Plasmid", "Plasmid"),
        Antiplasmid: new PrestigeResource("Anti-Plasmid", "AntiPlasmid"),
        Phage: new PrestigeResource("Phage", "Phage"),
        Dark: new PrestigeResource("Dark", "Dark"),
        Harmony: new PrestigeResource("Harmony", "Harmony"),
        AICore: new PrestigeResource("AI Core", "AICore"),

        // Special not-really-resources-but-we'll-treat-them-like-resources resources
        Supply: new Supply("Supplies", "Supply"),
        Power: new Power("Power", "Power"),
        Morale: new Morale("Morale", "Morale"),
        Thrall: new Thrall("Thrall", "Thrall"),
        Womlings_Support: new WomlingsSupport("Womlings", "Womlings_Support", "", ""),
        Moon_Support: new Support("Moon Support", "Moon_Support", "space", "spc_moon"),
        Red_Support: new Support("Red Support", "Red_Support", "space", "spc_red"),
        Sun_Support: new Support("Sun Support", "Sun_Support", "space", "spc_sun"),
        Belt_Support: new BeltSupport("Belt Support", "Belt_Support", "space", "spc_belt"),
        Titan_Support: new Support("Titan Support", "Titan_Support", "space", "spc_titan"),
        Electrolysis_Support: new ElectrolysisSupport("Electrolysis Plant", "Electrolysis_Support", "", ""),
        Enceladus_Support: new Support("Enceladus Support", "Enceladus_Support", "space", "spc_enceladus"),
        Eris_Support: new Support("Eris Support", "Eris_Support", "space", "spc_eris"),

        Tau_Support: new Support("Tau Ceti Support", "Tau_Support", "tauceti", "tau_home"),
        Tau_Red_Support: new Support("Tau Ceti Red Support", "Tau_Red_Support", "tauceti", "tau_red"),
        Tau_Belt_Support: new Support("Tau Ceti Belt Support", "Tau_Belt_Support", "tauceti", "tau_roid"),

        Alpha_Support: new Support("Alpha Support", "Alpha_Support", "interstellar", "int_alpha"),
        Nebula_Support: new Support("Nebula Support", "Nebula_Support", "interstellar", "int_nebula"),
        Gateway_Support: new Support("Gateway Support", "Gateway_Support", "galaxy", "gxy_gateway"),
        Alien_Support: new Support("Alien Support", "Alien_Support", "galaxy", "gxy_alien2"),
        Lake_Support: new Support("Lake Support", "Lake_Support", "portal", "prtl_lake"),
        Spire_Support: new Support("Spire Support", "Spire_Support", "portal", "prtl_spire"),
    }

    var jobs = {
        Unemployed: new BasicJob("unemployed", "Unemployed"),
        Colonist: new Job("colonist", "Colonist"),
        Teamster: new BasicJob("teamster", "Teamster", {smart: true}),
        Hunter: new BasicJob("hunter", "Hunter", {serve: true, smart: true}),
        Farmer: new BasicJob("farmer", "Farmer", {serve: true, smart: true}),
        //Forager: new BasicJob("forager", "Forager", {serve: true}),
        Lumberjack: new BasicJob("lumberjack", "Lumberjack", {serve: true, split: true, smart: true}),
        QuarryWorker: new BasicJob("quarry_worker", "Quarry Worker", {serve: true, split: true, smart: true}),
        CrystalMiner: new BasicJob("crystal_miner", "Crystal Miner", {serve: true, split: true, smart: true}),
        Scavenger: new BasicJob("scavenger", "Scavenger", {serve: true, split: true}),

        TitanColonist: new Job("titan_colonist", "Titan Colonist"),
        Miner: new Job("miner", "Miner", {smart: true}),
        CoalMiner: new Job("coal_miner", "Coal Miner", {smart: true}),
        CementWorker: new Job("cement_worker", "Cement Worker", {smart: true}),
        Professor: new Job("professor", "Professor", {smart: true}),
        Scientist: new Job("scientist", "Scientist", {smart: true}),
        Entertainer: new Job("entertainer", "Entertainer", {smart: true}),
        HellSurveyor: new Job("hell_surveyor", "Hell Surveyor", {smart: true}),
        SpaceMiner: new Job("space_miner", "Space Miner", {smart: true}),
        PitMiner: new Job("pit_miner", "Pit Miner"),
        Torturer: new Job("torturer", "Tormentor", {smart: true}),
        Archaeologist: new Job("archaeologist", "Archaeologist"),
        Banker: new Job("banker", "Banker", {smart: true}),
        Priest: new Job("priest", "Priest"),
    }

    // Non-manual crafts should be on top
    var crafter = {
        Scarletite: new CraftingJob("Scarletite", "Scarletite Crafter", resources.Scarletite),
        Quantium: new CraftingJob("Quantium", "Quantium Crafter", resources.Quantium),
        Plywood: new CraftingJob("Plywood", "Plywood Crafter", resources.Plywood),
        Brick: new CraftingJob("Brick", "Brick Crafter", resources.Brick),
        WroughtIron: new CraftingJob("Wrought_Iron", "Wrought Iron Crafter", resources.Wrought_Iron),
        SheetMetal: new CraftingJob("Sheet_Metal", "Sheet Metal Crafter", resources.Sheet_Metal),
        Mythril: new CraftingJob("Mythril", "Mythril Crafter", resources.Mythril),
        Aerogel: new CraftingJob("Aerogel", "Aerogel Crafter", resources.Aerogel),
        Nanoweave: new CraftingJob("Nanoweave", "Nanoweave Crafter", resources.Nanoweave),
    }

    var buildings = {
        Food: new ResourceAction("Gather Food", "city", "food", "", "Food"),
        Lumber: new ResourceAction("Gather Lumber", "city", "lumber", "", "Lumber"),
        Stone: new ResourceAction("Gather Stone", "city", "stone", "", "Stone"),
        Chrysotile: new ResourceAction("Gather Chrysotile", "city", "chrysotile", "", "Chrysotile"),
        Slaughter: new Action("Slaughter the Weak", "city", "slaughter", ""),
        ForgeHorseshoe: new ResourceAction("Horseshoe", "city", "horseshoe", "", "Horseshoe", {housing: true, garrison: true}),
        SlaveMarket: new ResourceAction("Slave Market", "city", "slave_market", "", "Slave"),
        SacrificialAltar: new Action("Sacrificial Altar", "city", "s_alter", ""),
        House: new Action("Cabin", "city", "basic_housing", "", {housing: true}),
        Cottage: new Action("Cottage", "city", "cottage", "", {housing: true}),
        Apartment: new Action("Apartment", "city", "apartment", "", {housing: true}),
        Lodge: new Action("Lodge", "city", "lodge", "", {housing: true}),
        Smokehouse: new Action("Smokehouse", "city", "smokehouse", ""),
        SoulWell: new Action("Soul Well", "city", "soul_well", ""),
        SlavePen: new Action("Slave Pen", "city", "slave_pen", ""),
        Transmitter: new Action("Transmitter", "city", "transmitter", "", {housing: true}),
        CaptiveHousing: new Action("Captive Housing", "city", "captive_housing", ""),
        Farm: new Action("Farm", "city", "farm", "", {housing: true}),
        CompostHeap: new Action("Compost Heap", "city", "compost", ""),
        Mill: new Action("Windmill", "city", "mill", "", {smart: true}),
        Windmill: new Action("Windmill (Evil)", "city", "windmill", ""),
        Silo: new Action("Grain Silo", "city", "silo", ""),
        Assembly: new ResourceAction("Assembly", "city", "assembly", "", "Population", {housing: true}),
        Barracks: new Action("Barracks", "city", "garrison", "", {garrison: true}),
        Hospital: new Action("Hospital", "city", "hospital", ""),
        BootCamp: new Action("Boot Camp", "city", "boot_camp", ""),
        Shed: new Action("Shed", "city", "shed", ""),
        StorageYard: new Action("Freight Yard", "city", "storage_yard", ""),
        Warehouse: new Action("Container Port", "city", "warehouse", ""),
        Bank: new Action("Bank", "city", "bank", ""),
        Pylon: new Action("Pylon", "city", "pylon", ""),
        ConcealWard: new Action("Conceal Ward (Witch Hunting)", "city", "conceal_ward", ""),
        Graveyard: new Action ("Graveyard", "city", "graveyard", ""),
        LumberYard: new Action("Lumber Yard", "city", "lumber_yard", ""),
        Sawmill: new Action("Sawmill", "city", "sawmill", ""),
        RockQuarry: new Action("Rock Quarry", "city", "rock_quarry", ""),
        CementPlant: new Action("Cement Plant", "city", "cement_plant", "", {smart: true}),
        Foundry: new Action("Foundry", "city", "foundry", ""),
        Factory: new Action("Factory", "city", "factory", ""),
        NaniteFactory: new Action("Nanite Factory", "city", "nanite_factory", ""),
        Smelter: new Action("Smelter", "city", "smelter", ""),
        MetalRefinery: new Action("Metal Refinery", "city", "metal_refinery", ""),
        Mine: new Action("Mine", "city", "mine", "", {smart: true}),
        CoalMine: new Action("Coal Mine", "city", "coal_mine", "", {smart: true}),
        OilWell: new Action("Oil Derrick", "city", "oil_well", ""),
        OilDepot: new Action("Fuel Depot", "city", "oil_depot", ""),
        Trade: new Action("Trade Post", "city", "trade", ""),
        Wharf: new Action("Wharf", "city", "wharf", ""),
        TouristCenter: new Action("Tourist Center", "city", "tourist_center", "", {smart: true}),
        Amphitheatre: new Action("Amphitheatre", "city", "amphitheatre", ""),
        Casino: new Action("Casino", "city", "casino", ""),
        Temple: new Action("Temple", "city", "temple", ""),
        Shrine: new Action ("Shrine", "city", "shrine", ""),
        MeditationChamber: new Action("Meditation Chamber", "city", "meditation", ""),
        University: new Action("University", "city", "university", "", {knowledge: true}),
        Library: new Action("Library", "city", "library", "", {knowledge: true}),
        Wardenclyffe: new Action("Wardenclyffe", "city", "wardenclyffe", "", {knowledge: true}),
        BioLab: new Action("Bioscience Lab", "city", "biolab", "", {knowledge: true}),
        CoalPower: new Action("Coal Powerplant", "city", "coal_power", ""),
        OilPower: new Action("Oil Powerplant", "city", "oil_power", ""),
        FissionPower: new Action("Fission Reactor", "city", "fission_power", ""),
        MassDriver: new Action("Mass Driver", "city", "mass_driver", "", {knowledge: () => haveTech("mass", 2)}),

        SpaceTestLaunch: new Action("Space Test Launch", "space", "test_launch", "spc_home"),
        SpaceSatellite: new Action("Space Satellite", "space", "satellite", "spc_home", {knowledge: true}),
        SpaceGps: new Action("Space Gps", "space", "gps", "spc_home"),
        SpacePropellantDepot: new Action("Space Propellant Depot", "space", "propellant_depot", "spc_home"),
        SpaceNavBeacon: new Action("Space Navigation Beacon", "space", "nav_beacon", "spc_home"),

        MoonMission: new Action("Moon Mission", "space", "moon_mission", "spc_moon"),
        MoonBase: new Action("Moon Base", "space", "moon_base", "spc_moon"),
        MoonIridiumMine: new Action("Moon Iridium Mine", "space", "iridium_mine", "spc_moon", {smart: true}),
        MoonHeliumMine: new Action("Moon Helium-3 Mine", "space", "helium_mine", "spc_moon", {smart: true}),
        MoonObservatory: new Action("Moon Observatory", "space", "observatory", "spc_moon", {knowledge: true}),

        RedMission: new Action("Red Mission", "space", "red_mission", "spc_red"),
        RedSpaceport: new Action("Red Spaceport", "space", "spaceport", "spc_red"),
        RedTower: new Action("Red Space Control", "space", "red_tower", "spc_red"),
        RedCaptiveHousing: new CityAction("Red Captive Housing (Cataclysm)", "space", "captive_housing", "spc_red"),
        RedTerraformer: new Action("Red Terraformer (Orbit Decay)", "space", "terraformer", "spc_red", {multiSegmented: true}),
        RedAtmoTerraformer: new Action("Red Terraformer (Orbit Decay, Complete)", "space", "atmo_terraformer", "spc_red"),
        RedTerraform: new Action("Red Terraform (Orbit Decay)", "space", "terraform", "spc_red", {prestige: true}),
        RedAssembly: new ResourceAction("Red Assembly (Cataclysm)", "space", "assembly", "spc_red", "Population", {housing: true}),
        RedLivingQuarters: new Action("Red Living Quarters", "space", "living_quarters", "spc_red", {housing: true}),
        RedPylon: new Action("Red Pylon (Cataclysm)", "space", "pylon", "spc_red"),
        RedVrCenter: new Action("Red VR Center", "space", "vr_center", "spc_red"),
        RedGarage: new Action("Red Garage", "space", "garage", "spc_red"),
        RedMine: new Action("Red Mine", "space", "red_mine", "spc_red"),
        RedFabrication: new Action("Red Fabrication", "space", "fabrication", "spc_red"),
        RedFactory: new Action("Red Factory", "space", "red_factory", "spc_red"),
        RedNaniteFactory: new CityAction("Red Nanite Factory (Cataclysm)", "space", "nanite_factory", "spc_red"),
        RedBiodome: new Action("Red Biodome", "space", "biodome", "spc_red"),
        RedUniversity: new Action("Red University (Orbit Decay)", "space", "red_university", "spc_red", {knowledge: true}),
        RedExoticLab: new Action("Red Exotic Materials Lab", "space", "exotic_lab", "spc_red", {knowledge: true}),
        RedZiggurat: new Action("Red Ziggurat", "space", "ziggurat", "spc_red"),
        RedSpaceBarracks: new Action("Red Marine Barracks", "space", "space_barracks", "spc_red", {garrison: true}),
        RedForgeHorseshoe: new ResourceAction("Red Horseshoe (Cataclysm)", "space", "horseshoe", "spc_red", "Horseshoe", {housing: true, garrison: true}),

        HellMission: new Action("Hell Mission", "space", "hell_mission", "spc_hell"),
        HellGeothermal: new Action("Hell Geothermal Plant", "space", "geothermal", "spc_hell"),
        HellSmelter: new Action("Hell Smelter", "space", "hell_smelter", "spc_hell"),
        HellSpaceCasino: new Action("Hell Space Casino", "space", "spc_casino", "spc_hell"),
        HellSwarmPlant: new Action("Hell Swarm Plant", "space", "swarm_plant", "spc_hell"),

        SunMission: new Action("Sun Mission", "space", "sun_mission", "spc_sun"),
        SunSwarmControl: new Action("Sun Control Station", "space", "swarm_control", "spc_sun"),
        SunSwarmSatellite: new Action("Sun Swarm Satellite", "space", "swarm_satellite", "spc_sun"),
        SunJumpGate: new Action("Sun Jump Gate", "space", "jump_gate", "spc_sun", {multiSegmented: true}),

        GasMission: new Action("Gas Mission", "space", "gas_mission", "spc_gas"),
        GasMining: new Action("Gas Helium-3 Collector", "space", "gas_mining", "spc_gas", {smart: true}),
        GasStorage: new Action("Gas Fuel Depot", "space", "gas_storage", "spc_gas"),
        GasSpaceDock: new SpaceDock("Gas Space Dock", "space", "star_dock", "spc_gas"),
        GasSpaceDockProbe: new ModalAction("Space Dock Probe", "starDock", "probes", ""),
        GasSpaceDockGECK: new ModalAction("Space Dock G.E.C.K.", "starDock", "geck", ""),
        GasSpaceDockShipSegment: new ModalAction("Space Dock Bioseeder Ship", "starDock", "seeder", "", {multiSegmented: true}),
        GasSpaceDockPrepForLaunch: new ModalAction("Space Dock Prep Ship", "starDock", "prep_ship", ""),
        GasSpaceDockLaunch: new ModalAction("Space Dock Launch Ship", "starDock", "launch_ship", "", {prestige: true}),

        GasMoonMission: new Action("Gas Moon Mission", "space", "gas_moon_mission", "spc_gas_moon"),
        GasMoonOutpost: new Action("Gas Moon Mining Outpost", "space", "outpost", "spc_gas_moon"),
        GasMoonDrone: new Action("Gas Moon Mining Drone", "space", "drone", "spc_gas_moon"),
        GasMoonOilExtractor: new Action("Gas Moon Oil Extractor", "space", "oil_extractor", "spc_gas_moon", {smart: true}),

        BeltMission: new Action("Belt Mission", "space", "belt_mission", "spc_belt"),
        BeltSpaceStation: new Action("Belt Space Station", "space", "space_station", "spc_belt", {smart: true}),
        BeltEleriumShip: new Action("Belt Elerium Mining Ship", "space", "elerium_ship", "spc_belt", {smart: true}),
        BeltIridiumShip: new Action("Belt Iridium Mining Ship", "space", "iridium_ship", "spc_belt", {smart: true}),
        BeltIronShip: new Action("Belt Iron Mining Ship", "space", "iron_ship", "spc_belt", {smart: true}),

        DwarfMission: new Action("Dwarf Mission", "space", "dwarf_mission", "spc_dwarf"),
        DwarfEleriumContainer: new Action("Dwarf Elerium Storage", "space", "elerium_contain", "spc_dwarf"),
        DwarfEleriumReactor: new Action("Dwarf Elerium Reactor", "space", "e_reactor", "spc_dwarf"),
        DwarfWorldCollider: new Action("Dwarf World Collider", "space", "world_collider", "spc_dwarf", {multiSegmented: true}),
        DwarfWorldController: new Action("Dwarf World Collider (Complete)", "space", "world_controller", "spc_dwarf", {knowledge: true}),
        DwarfShipyard: new Action("Dwarf Ship Yard", "space", "shipyard", "spc_dwarf"),
        DwarfMassRelay: new Action("Dwarf Mass Relay", "space", "mass_relay", "spc_dwarf", {multiSegmented: true}),
        DwarfMassRelayComplete: new Action("Dwarf Mass Relay (Complete)", "space", "m_relay", "spc_dwarf"),

        TitanMission: new Action("Titan Mission", "space", "titan_mission", "spc_titan"),
        TitanSpaceport: new Action("Titan Spaceport", "space", "titan_spaceport", "spc_titan"),
        TitanElectrolysis: new Action("Titan Electrolysis", "space", "electrolysis", "spc_titan"),
        TitanHydrogen: new Action("Titan Hydrogen Plant", "space", "hydrogen_plant", "spc_titan"),
        TitanQuarters: new Action("Titan Habitat", "space", "titan_quarters", "spc_titan"),
        TitanMine: new Action("Titan Mine", "space", "titan_mine", "spc_titan"),
        TitanStorehouse: new Action("Titan Storehouse", "space", "storehouse", "spc_titan"),
        TitanBank: new Action("Titan Bank", "space", "titan_bank", "spc_titan"),
        TitanGraphene: new Action("Titan Graphene Plant", "space", "g_factory", "spc_titan"),
        TitanSAM: new Action("Titan SAM Site", "space", "sam", "spc_titan"),
        TitanDecoder: new Action("Titan Decoder", "space", "decoder", "spc_titan"),
        TitanAI: new Action("Titan AI Core", "space", "ai_core", "spc_titan", {multiSegmented: true}),
        TitanAIComplete: new Action("Titan AI Core (Complete)", "space", "ai_core2", "spc_titan"),
        TitanAIColonist: new Action("Titan AI Colonist", "space", "ai_colonist", "spc_titan"),
        EnceladusMission: new Action("Enceladus Mission", "space", "enceladus_mission", "spc_enceladus"),
        EnceladusWaterFreighter: new Action("Enceladus Water Freighter", "space", "water_freighter", "spc_enceladus", {smart: true}),
        EnceladusZeroGLab: new Action("Enceladus Zero Gravity Lab", "space", "zero_g_lab", "spc_enceladus"),
        EnceladusBase: new Action("Enceladus Operational Base", "space", "operating_base", "spc_enceladus"),
        EnceladusMunitions: new Action("Enceladus Munitions Depot", "space", "munitions_depot", "spc_enceladus"),
        TritonMission: new Action("Triton Mission", "space", "triton_mission", "spc_triton"),
        TritonFOB: new Action("Triton Forward Base", "space", "fob", "spc_triton"),
        TritonLander: new Action("Triton Troop Lander", "space", "lander", "spc_triton", {smart: true}),
        TritonCrashedShip: new Action("Triton Derelict Ship", "space", "crashed_ship", "spc_triton"),
        KuiperMission: new Action("Kuiper Mission", "space", "kuiper_mission", "spc_kuiper"),
        KuiperOrichalcum: new Action("Kuiper Orichalcum Mine", "space", "orichalcum_mine", "spc_kuiper", {smart: true}),
        KuiperUranium: new Action("Kuiper Uranium Mine", "space", "uranium_mine", "spc_kuiper", {smart: true}),
        KuiperNeutronium: new Action("Kuiper Neutronium Mine", "space", "neutronium_mine", "spc_kuiper", {smart: true}),
        KuiperElerium: new Action("Kuiper Elerium Mine", "space", "elerium_mine", "spc_kuiper", {smart: true}),
        ErisMission: new Action("Eris Mission", "space", "eris_mission", "spc_eris"),
        ErisDrone: new Action("Eris Control Relay", "space", "drone_control", "spc_eris"),
        ErisTrooper: new Action("Eris Android Trooper", "space", "shock_trooper", "spc_eris"),
        ErisTank: new Action("Eris Tank", "space", "tank", "spc_eris"),
        ErisDigsite: new Action("Eris Digsite", "space", "digsite", "spc_eris"),

        TauStarRingworld: new Action("Tau Star Ringworld", "tauceti", "ringworld", "tau_star", {multiSegmented: true}),
        TauStarMatrix: new Action("Tau Star Matrix", "tauceti", "matrix", "tau_star"),
        TauStarBluePill: new Action("Tau Star Blue Pill", "tauceti", "blue_pill", "tau_star", {prestige: true}),
        TauStarEden: new Action("Tau Star Garden of Eden", "tauceti", "goe_facility", "tau_star", {prestige: true}),

        TauMission: new Action("Tau Mission", "tauceti", "home_mission", "tau_home"),
        TauDismantle: new Action("Tau Dismantle Ship", "tauceti", "dismantle", "tau_home"),
        TauOrbitalStation: new Action("Tau Orbital Station", "tauceti", "orbital_station", "tau_home"),
        TauColony: new Action("Tau Colony", "tauceti", "colony", "tau_home", {housing: true, smart: true}),
        TauHousing: new Action("Tau Housing", "tauceti", "tau_housing", "tau_home", {housing: true}),
        TauCaptiveHousing: new CityAction("Tau Captive Housing", "tauceti", "captive_housing", "tau_home"),
        TauPylon: new Action("Tau Pylon", "tauceti", "pylon", "tau_home"),
        TauCloning: new ResourceAction("Tau Cloning", "tauceti", "cloning_facility", "tau_home", "Population", {housing: true}),
        TauForgeHorseshoe: new ResourceAction("Tau Horseshoe", "tauceti", "horseshoe", "tau_home", "Horseshoe", {housing: true, garrison: true}),
        TauAssembly: new ResourceAction("Tau Assembly", "tauceti", "assembly", "tau_home", "Population", {housing: true}),
        TauNaniteFactory: new CityAction("Tau Nanite Factory", "tauceti", "nanite_factory", "tau_home"),
        TauFarm: new Action("Tau High-Tech Farm", "tauceti", "tau_farm", "tau_home"),
        TauMiningPit: new Action("Tau Mining Pit", "tauceti", "mining_pit", "tau_home", {smart: true}),
        TauExcavate: new Action("Tau Excavate", "tauceti", "excavate", "tau_home"),
        TauAlienOutpost: new Action("Tau Alien Outpost", "tauceti", "alien_outpost", "tau_home", {knowledge: true}),
        TauJumpGate: new Action("Tau Jump Gate", "tauceti", "jump_gate", "tau_home", {multiSegmented: true}),
        TauFusionGenerator: new Action("Tau Fusion Generator", "tauceti", "fusion_generator", "tau_home"),
        TauRepository: new Action("Tau Repository", "tauceti", "repository", "tau_home"),
        TauFactory: new Action("Tau High-Tech Factory", "tauceti", "tau_factory", "tau_home"),
        TauDiseaseLab: new Action("Tau Disease Lab", "tauceti", "infectious_disease_lab", "tau_home", {knowledge: true}),
        TauCasino: new Action("Tau Casino", "tauceti", "tauceti_casino", "tau_home"),
        TauCulturalCenter: new Action("Tau Cultural Center", "tauceti", "tau_cultural_center", "tau_home"),

        TauRedMission: new Action("Tau Red Mission", "tauceti", "red_mission", "tau_red"),
        TauRedOrbitalPlatform: new Action("Tau Red Orbital Platform", "tauceti", "orbital_platform", "tau_red"),
        TauRedContact: new Action("Tau Red Contact", "tauceti", "contact", "tau_red"),
        TauRedIntroduce: new Action("Tau Red Introduce", "tauceti", "introduce", "tau_red"),
        TauRedSubjugate: new Action("Tau Red Subjugate", "tauceti", "subjugate", "tau_red"),
        TauRedJeff: new Action("Tau Red Jeff", "tauceti", "jeff", "tau_red"),
        TauRedOverseer: new Action("Tau Red Overseer", "tauceti", "overseer", "tau_red", {smart: true}),
        TauRedWomlingVillage: new Action("Tau Red Womling Village", "tauceti", "womling_village", "tau_red"),
        TauRedWomlingFarm: new Action("Tau Red Womling Farm", "tauceti", "womling_farm", "tau_red", {smart: true}),
        TauRedWomlingMine: new Action("Tau Red Womling Mine", "tauceti", "womling_mine", "tau_red", {smart: true}),
        TauRedWomlingFun: new Action("Tau Red Womling Theater", "tauceti", "womling_fun", "tau_red", {smart: true}),
        TauRedWomlingLab: new Action("Tau Red Womling Lab", "tauceti", "womling_lab", "tau_red", {smart: true, knowledge: true}),

        TauGasContest: new Action("Tau Gas Naming Contest", "tauceti", "gas_contest", "tau_gas"),
        TauGasName1: new Action("Tau Gas Name 1", "tauceti", "gas_contest-a1", "tau_gas", {random: true}),
        TauGasName2: new Action("Tau Gas Name 2", "tauceti", "gas_contest-a2", "tau_gas", {random: true}),
        TauGasName3: new Action("Tau Gas Name 3", "tauceti", "gas_contest-a3", "tau_gas", {random: true}),
        TauGasName4: new Action("Tau Gas Name 4", "tauceti", "gas_contest-a4", "tau_gas", {random: true}),
        TauGasName5: new Action("Tau Gas Name 5", "tauceti", "gas_contest-a5", "tau_gas", {random: true}),
        TauGasName6: new Action("Tau Gas Name 6", "tauceti", "gas_contest-a6", "tau_gas", {random: true}),
        TauGasName7: new Action("Tau Gas Name 7", "tauceti", "gas_contest-a7", "tau_gas", {random: true}),
        TauGasName8: new Action("Tau Gas Name 8", "tauceti", "gas_contest-a8", "tau_gas", {random: true}),
        TauGasRefuelingStation: new Action("Tau Gas Refueling Station", "tauceti", "refueling_station", "tau_gas"),
        TauGasOreRefinery: new Action("Tau Gas Ore Refinery", "tauceti", "ore_refinery", "tau_gas"),
        TauGasWhalingStation: new Action("Tau Gas Whale Processor", "tauceti", "whaling_station", "tau_gas", {smart: true}),
        TauGasWomlingStation: new Action("Tau Gas Womling Station", "tauceti", "womling_station", "tau_gas"),

        TauBeltMission: new Action("Tau Belt Mission", "tauceti", "roid_mission", "tau_roid"),
        TauBeltPatrolShip: new Action("Tau Belt Patrol Ship", "tauceti", "patrol_ship", "tau_roid"),
        TauBeltMiningShip: new Action("Tau Belt Extractor Ship", "tauceti", "mining_ship", "tau_roid"),
        TauBeltWhalingShip: new Action("Tau Belt Whaling Ship", "tauceti", "whaling_ship", "tau_roid"),

        TauGas2Contest: new Action("Tau Gas 2 Naming Contest", "tauceti", "gas_contest2", "tau_gas2"),
        TauGas2Name1: new Action("Tau Gas 2 Name 1", "tauceti", "gas_contest-b1", "tau_gas2", {random: true}),
        TauGas2Name2: new Action("Tau Gas 2 Name 2", "tauceti", "gas_contest-b2", "tau_gas2", {random: true}),
        TauGas2Name3: new Action("Tau Gas 2 Name 3", "tauceti", "gas_contest-b3", "tau_gas2", {random: true}),
        TauGas2Name4: new Action("Tau Gas 2 Name 4", "tauceti", "gas_contest-b4", "tau_gas2", {random: true}),
        TauGas2Name5: new Action("Tau Gas 2 Name 5", "tauceti", "gas_contest-b5", "tau_gas2", {random: true}),
        TauGas2Name6: new Action("Tau Gas 2 Name 6", "tauceti", "gas_contest-b6", "tau_gas2", {random: true}),
        TauGas2Name7: new Action("Tau Gas 2 Name 7", "tauceti", "gas_contest-b7", "tau_gas2", {random: true}),
        TauGas2Name8: new Action("Tau Gas 2 Name 8", "tauceti", "gas_contest-b8", "tau_gas2", {random: true}),
        TauGas2AlienSurvey: new Action("Tau Gas 2 Alien Station (Survey)", "tauceti", "alien_station_survey", "tau_gas2"),
        TauGas2AlienStation: new Action("Tau Gas 2 Alien Station", "tauceti", "alien_station", "tau_gas2", {multiSegmented: true}),
        TauGas2AlienSpaceStation: new Action("Tau Gas 2 Alien Space Station", "tauceti", "alien_space_station", "tau_gas2"),
        TauGas2MatrioshkaBrain: new Action("Tau Gas 2 Matrioshka Brain", "tauceti", "matrioshka_brain", "tau_gas2", {multiSegmented: true}),
        TauGas2IgnitionDevice: new Action("Tau Gas 2 Ignition Device", "tauceti", "ignition_device", "tau_gas2", {multiSegmented: true}),
        TauGas2IgniteGasGiant: new Action("Tau Gas 2 Ignite Gas Giant", "tauceti", "ignite_gas_giant", "tau_gas2", {prestige: true}),

        AlphaMission: new Action("Alpha Centauri Mission", "interstellar", "alpha_mission", "int_alpha"),
        AlphaStarport: new Action("Alpha Starport", "interstellar", "starport", "int_alpha"),
        AlphaHabitat: new Action("Alpha Habitat", "interstellar", "habitat", "int_alpha", {housing: true}),
        AlphaMiningDroid: new Action("Alpha Mining Droid", "interstellar", "mining_droid", "int_alpha"),
        AlphaProcessing: new Action("Alpha Processing Facility", "interstellar", "processing", "int_alpha"),
        AlphaFusion: new Action("Alpha Fusion Reactor", "interstellar", "fusion", "int_alpha"),
        AlphaLaboratory: new Action("Alpha Laboratory", "interstellar", "laboratory", "int_alpha", {knowledge: true}),
        AlphaExchange: new Action("Alpha Exchange", "interstellar", "exchange", "int_alpha"),
        AlphaGraphenePlant: new Action("Alpha Graphene Plant", "interstellar", "g_factory", "int_alpha"),
        AlphaWarehouse: new Action("Alpha Warehouse", "interstellar", "warehouse", "int_alpha"),
        AlphaMegaFactory: new Action("Alpha Mega Factory", "interstellar", "int_factory", "int_alpha"),
        AlphaLuxuryCondo: new Action("Alpha Luxury Condo", "interstellar", "luxury_condo", "int_alpha", {housing: true}),
        AlphaExoticZoo: new Action("Alpha Exotic Zoo", "interstellar", "zoo", "int_alpha"),

        ProximaMission: new Action("Proxima Mission", "interstellar", "proxima_mission", "int_proxima"),
        ProximaTransferStation: new Action("Proxima Transfer Station", "interstellar", "xfer_station", "int_proxima"),
        ProximaCargoYard: new Action("Proxima Cargo Yard", "interstellar", "cargo_yard", "int_proxima"),
        ProximaCruiser: new Action("Proxima Patrol Cruiser", "interstellar", "cruiser", "int_proxima", {garrison: true}),
        ProximaDyson: new Action("Proxima Dyson Sphere (Adamantite)", "interstellar", "dyson", "int_proxima", {multiSegmented: true}),
        ProximaDysonSphere: new Action("Proxima Dyson Sphere (Bolognium)", "interstellar", "dyson_sphere", "int_proxima", {multiSegmented: true}),
        ProximaOrichalcumSphere: new Action("Proxima Dyson Sphere (Orichalcum)", "interstellar", "orichalcum_sphere", "int_proxima", {multiSegmented: true}),

        NebulaMission: new Action("Nebula Mission", "interstellar", "nebula_mission", "int_nebula"),
        NebulaNexus: new Action("Nebula Nexus", "interstellar", "nexus", "int_nebula"),
        NebulaHarvester: new Action("Nebula Harvester", "interstellar", "harvester", "int_nebula", {smart: true}),
        NebulaEleriumProspector: new Action("Nebula Elerium Prospector", "interstellar", "elerium_prospector", "int_nebula"),

        NeutronMission: new Action("Neutron Mission", "interstellar", "neutron_mission", "int_neutron"),
        NeutronMiner: new Action("Neutron Miner", "interstellar", "neutron_miner", "int_neutron"),
        NeutronCitadel: new Action("Neutron Citadel Station", "interstellar", "citadel", "int_neutron"),
        NeutronStellarForge: new Action("Neutron Stellar Forge", "interstellar", "stellar_forge", "int_neutron"),

        Blackhole: new Action("Blackhole Mission", "interstellar", "blackhole_mission", "int_blackhole"),
        BlackholeFarReach: new Action("Blackhole Farpoint", "interstellar", "far_reach", "int_blackhole", {knowledge: true}),
        BlackholeStellarEngine: new Action("Blackhole Stellar Engine", "interstellar", "stellar_engine", "int_blackhole", {multiSegmented: true}),
        BlackholeMassEjector: new Action("Blackhole Mass Ejector", "interstellar", "mass_ejector", "int_blackhole"),

        BlackholeJumpShip: new Action("Blackhole Jump Ship", "interstellar", "jump_ship", "int_blackhole"),
        BlackholeWormholeMission: new Action("Blackhole Wormhole Mission", "interstellar", "wormhole_mission", "int_blackhole"),
        BlackholeStargate: new Action("Blackhole Stargate", "interstellar", "stargate", "int_blackhole", {multiSegmented: true}),
        BlackholeStargateComplete: new Action("Blackhole Stargate (Complete)", "interstellar", "s_gate", "int_blackhole"),

        SiriusMission: new Action("Sirius Mission", "interstellar", "sirius_mission", "int_sirius"),
        SiriusAnalysis: new Action("Sirius B Analysis", "interstellar", "sirius_b", "int_sirius"),
        SiriusSpaceElevator: new Action("Sirius Space Elevator", "interstellar", "space_elevator", "int_sirius", {multiSegmented: true}),
        SiriusGravityDome: new Action("Sirius Gravity Dome", "interstellar", "gravity_dome", "int_sirius", {multiSegmented: true}),
        SiriusAscensionMachine: new Action("Sirius Ascension Machine", "interstellar", "ascension_machine", "int_sirius", {multiSegmented: true}),
        SiriusAscensionTrigger: new Action("Sirius Ascension Machine (Complete)", "interstellar", "ascension_trigger", "int_sirius", {smart: true}),
        SiriusAscend: new Action("Sirius Ascend", "interstellar", "ascend", "int_sirius", {prestige: true}),
        SiriusThermalCollector: new Action("Sirius Thermal Collector", "interstellar", "thermal_collector", "int_sirius"),

        GatewayMission: new Action("Gateway Mission", "galaxy", "gateway_mission", "gxy_gateway"),
        GatewayStarbase: new Action("Gateway Starbase", "galaxy", "starbase", "gxy_gateway", {garrison: true}),
        GatewayShipDock: new Action("Gateway Ship Dock", "galaxy", "ship_dock", "gxy_gateway"),

        BologniumShip: new Action("Gateway Bolognium Ship", "galaxy", "bolognium_ship", "gxy_gateway", {ship: true, smart: true}),
        ScoutShip: new Action("Gateway Scout Ship", "galaxy", "scout_ship", "gxy_gateway", {ship: true, smart: true}),
        CorvetteShip: new Action("Gateway Corvette Ship", "galaxy", "corvette_ship", "gxy_gateway", {ship: true, smart: true}),
        FrigateShip: new Action("Gateway Frigate Ship", "galaxy", "frigate_ship", "gxy_gateway", {ship: true}),
        CruiserShip: new Action("Gateway Cruiser Ship", "galaxy", "cruiser_ship", "gxy_gateway", {ship: true}),
        Dreadnought: new Action("Gateway Dreadnought", "galaxy", "dreadnought", "gxy_gateway", {ship: true}),

        StargateStation: new Action("Stargate Station", "galaxy", "gateway_station", "gxy_stargate"),
        StargateTelemetryBeacon: new Action("Stargate Telemetry Beacon", "galaxy", "telemetry_beacon", "gxy_stargate", {knowledge: true}),
        StargateDepot: new Action("Stargate Depot", "galaxy", "gateway_depot", "gxy_stargate"),
        StargateDefensePlatform: new Action("Stargate Defense Platform", "galaxy", "defense_platform", "gxy_stargate"),

        GorddonMission: new Action("Gorddon Mission", "galaxy", "gorddon_mission", "gxy_gorddon"),
        GorddonEmbassy: new Action("Gorddon Embassy", "galaxy", "embassy", "gxy_gorddon", {housing: true}),
        GorddonDormitory: new Action("Gorddon Dormitory", "galaxy", "dormitory", "gxy_gorddon", {housing: true}),
        GorddonSymposium: new Action("Gorddon Symposium", "galaxy", "symposium", "gxy_gorddon", {knowledge: true}),
        GorddonFreighter: new Action("Gorddon Freighter", "galaxy", "freighter", "gxy_gorddon", {ship: true}),

        Alien1Consulate: new Action("Alien 1 Consulate", "galaxy", "consulate", "gxy_alien1", {housing: true}),
        Alien1Resort: new Action("Alien 1 Resort", "galaxy", "resort", "gxy_alien1"),
        Alien1VitreloyPlant: new Action("Alien 1 Vitreloy Plant", "galaxy", "vitreloy_plant", "gxy_alien1", {smart: true}),
        Alien1SuperFreighter: new Action("Alien 1 Super Freighter", "galaxy", "super_freighter", "gxy_alien1", {ship: true}),

        Alien2Mission: new Action("Alien 2 Mission", "galaxy", "alien2_mission", "gxy_alien2"),
        Alien2Foothold: new Action("Alien 2 Foothold", "galaxy", "foothold", "gxy_alien2"),
        Alien2ArmedMiner: new Action("Alien 2 Armed Miner", "galaxy", "armed_miner", "gxy_alien2", {ship: true, smart: true}),
        Alien2OreProcessor: new Action("Alien 2 Ore Processor", "galaxy", "ore_processor", "gxy_alien2"),
        Alien2Scavenger: new Action("Alien 2 Scavenger", "galaxy", "scavenger", "gxy_alien2", {knowledge: true, ship: true}),

        ChthonianMission: new Action("Chthonian Mission", "galaxy", "chthonian_mission", "gxy_chthonian"),
        ChthonianMineLayer: new Action("Chthonian Mine Layer", "galaxy", "minelayer", "gxy_chthonian", {ship: true, smart: true}),
        ChthonianExcavator: new Action("Chthonian Excavator", "galaxy", "excavator", "gxy_chthonian", {smart: true}),
        ChthonianRaider: new Action("Chthonian Corsair", "galaxy", "raider", "gxy_chthonian", {ship: true, smart: true}),

        PortalTurret: new Action("Portal Laser Turret", "portal", "turret", "prtl_fortress"),
        PortalCarport: new Action("Portal Surveyor Carport", "portal", "carport", "prtl_fortress"),
        PortalWarDroid: new Action("Portal War Droid", "portal", "war_droid", "prtl_fortress"),
        PortalRepairDroid: new Action("Portal Repair Droid", "portal", "repair_droid", "prtl_fortress"),

        BadlandsPredatorDrone: new Action("Badlands Predator Drone", "portal", "war_drone", "prtl_badlands"),
        BadlandsSensorDrone: new Action("Badlands Sensor Drone", "portal", "sensor_drone", "prtl_badlands"),
        BadlandsAttractor: new Action("Badlands Attractor Beacon", "portal", "attractor", "prtl_badlands", {smart: true}),

        PitMission: new Action("Pit Mission", "portal", "pit_mission", "prtl_pit"),
        PitAssaultForge: new Action("Pit Assault Forge", "portal", "assault_forge", "prtl_pit"),
        PitSoulForge: new Action("Pit Soul Forge", "portal", "soul_forge", "prtl_pit"),
        PitGunEmplacement: new Action("Pit Gun Emplacement", "portal", "gun_emplacement", "prtl_pit"),
        PitSoulAttractor: new Action("Pit Soul Attractor", "portal", "soul_attractor", "prtl_pit"),
        PitSoulCapacitor: new Action("Pit Soul Capacitor (Witch Hunting)", "portal", "soul_capacitor", "prtl_pit"),
        PitAbsorptionChamber: new Action("Pit Absorption Chamber (Witch Hunting)", "portal", "absorption_chamber", "prtl_pit"),

        RuinsMission: new Action("Ruins Mission", "portal", "ruins_mission", "prtl_ruins"),
        RuinsGuardPost: new Action("Ruins Guard Post", "portal", "guard_post", "prtl_ruins", {smart: true}),
        RuinsVault: new Action("Ruins Vault", "portal", "vault", "prtl_ruins"),
        RuinsArchaeology: new Action("Ruins Archaeology", "portal", "archaeology", "prtl_ruins"),
        RuinsArcology: new Action("Ruins Arcology", "portal", "arcology", "prtl_ruins"),
        RuinsHellForge: new Action("Ruins Infernal Forge", "portal", "hell_forge", "prtl_ruins"),
        RuinsInfernoPower: new Action("Ruins Inferno Reactor", "portal", "inferno_power", "prtl_ruins"),
        RuinsAncientPillars: new Pillar("Ruins Ancient Pillars", "portal", "ancient_pillars", "prtl_ruins"),

        GateMission: new Action("Gate Mission", "portal", "gate_mission", "prtl_gate"),
        GateEastTower: new Action("Gate East Tower", "portal", "east_tower", "prtl_gate", {multiSegmented: true}),
        GateWestTower: new Action("Gate West Tower", "portal", "west_tower", "prtl_gate", {multiSegmented: true}),
        GateTurret: new Action("Gate Turret", "portal", "gate_turret", "prtl_gate"),
        GateInferniteMine: new Action("Gate Infernite Mine", "portal", "infernite_mine", "prtl_gate"),

        LakeMission: new Action("Lake Mission", "portal", "lake_mission", "prtl_lake"),
        LakeHarbour: new Action("Lake Harbour", "portal", "harbour", "prtl_lake", {smart: true}),
        LakeCoolingTower: new Action("Lake Cooling Tower", "portal", "cooling_tower", "prtl_lake", {smart: true}),
        LakeBireme: new Action("Lake Bireme Warship", "portal", "bireme", "prtl_lake", {smart: true}),
        LakeTransport: new Action("Lake Transport", "portal", "transport", "prtl_lake", {smart: true}),

        SpireMission: new Action("Spire Mission", "portal", "spire_mission", "prtl_spire"),
        SpirePurifier: new Action("Spire Purifier", "portal", "purifier", "prtl_spire", {smart: true}),
        SpirePort: new Action("Spire Port", "portal", "port", "prtl_spire", {smart: true}),
        SpireBaseCamp: new Action("Spire Base Camp", "portal", "base_camp", "prtl_spire", {smart: true}),
        SpireBridge: new Action("Spire Bridge", "portal", "bridge", "prtl_spire"),
        SpireSphinx: new Action("Spire Sphinx", "portal", "sphinx", "prtl_spire"),
        SpireBribeSphinx: new Action("Spire Bribe Sphinx", "portal", "bribe_sphinx", "prtl_spire"),
        SpireSurveyTower: new Action("Spire Survey Tower", "portal", "spire_survey", "prtl_spire"),
        SpireMechBay: new Action("Spire Mech Bay", "portal", "mechbay", "prtl_spire", {smart: true}),
        SpireTower: new Action("Spire Tower", "portal", "spire", "prtl_spire"),
        SpireWaygate: new Action("Spire Waygate", "portal", "waygate", "prtl_spire", {smart: true}),
    }

    var linkedBuildings = [
        [buildings.LakeTransport, buildings.LakeBireme],
        [buildings.SpirePort, buildings.SpireBaseCamp],
    ]

    var projects = {
        LaunchFacility: new Project("Launch Facility", "launch_facility"),
        SuperCollider: new Project("Supercollider", "lhc"),
        StockExchange: new Project("Stock Exchange", "stock_exchange"),
        Monument: new Project("Monument", "monument"),
        Railway: new Project("Railway", "railway"),
        Nexus: new Project("Nexus", "nexus"),
        RoidEject: new Project("Asteroid Redirect", "roid_eject"),
        ManaSyphon: new Project("Mana Syphon", "syphon"),
        Depot: new Project("Depot", "tp_depot"),
    }

    const wrGlobalCondition = 0; // Generic condition will be checked once per tick. Takes nothing and return bool - whether following rule is applicable, or not
    const wrIndividualCondition = 1; // Individual condition, checks every building, and return any value; if value casts to true - rule aplies
    const wrDescription = 2; // Description displayed in tooltip when rule applied, takes return value of individual condition, and building
    const wrMultiplier = 3; // Weighting mulptiplier. Called first without any context; rules returning x1 also won't be checked
    var weightingRules = [[
          () => !settings.autoBuild,
          () => true,
          () => "",
          () => 0 // Set weighting to zero right away, and skip all checks if autoBuild is disabled
      ],[
          () => true,
          (building) => !building.isUnlocked(),
          () => "Locked",
          () => 0 // Should always be on top, processing locked building may lead to issues
      ],[
          () => true,
          (building) => state.queuedTargets.includes(building),
          () => "Queued building, processing...",
          () => 0
      ],[
          () => true,
          (building) => state.triggerTargets.includes(building),
          () => "Active trigger, processing...",
          () => 0
      ],[
          () => true,
          (building) => !building.autoBuildEnabled,
          () => "AutoBuild disabled",
          () => 0
      ],[
          () => true,
          (building) => building.count >= building.autoMax,
          () => "Maximum amount reached",
          () => 0
      ],[
          () => true,
          (building) => !building.isAffordable(true),
          () => "",
          () => 0 // Red buildings need to be filtered out, so they won't prevent affordable buildings with lower weight from building
      ],[
          () => game.global.race['truepath'] && buildings.SpaceTestLaunch.isUnlocked() && !haveTech('world_control'),
          (building) => {
              if (building === buildings.SpaceTestLaunch) {
                  let sabotage = 1;
                  for (let i = 0; i < 3; i++){
                      let gov = game.global.civic.foreign[`gov${i}`];
                      if (!gov.occ && !gov.anx && !gov.buy) {
                          sabotage++;
                      }
                  }
                  return 1 / (sabotage + 1);
              }
          },
          (chance) => `${Math.round(chance*100)}% chance of successful launch`,
          (chance) => chance < 0.5 ? chance : 0
      ],[
          () => settings.jobDisableMiners && buildings.GatewayStarbase.count > 0,
          (building) => building === buildings.CoalMine || (building === buildings.Mine && !(game.global.race['sappy'] && game.global.race['smoldering'])),
          () => "Miners disabled in Andromeda",
          () => 0
      ],[
          () => haveTech('piracy'),
          (building) => building === buildings.StargateDefensePlatform && buildings.StargateDefensePlatform.count * 20 >= (game.global.race['instinct'] ? 0.09 : 0.1) * game.global.tech.piracy,
          () => "Piracy fully supressed",
          () => 0
      ],[
          () => settings.autoMech && settings.mechBuild !== "none" && settings.buildingMechsFirst && buildings.SpireMechBay.count > 0 && buildings.SpireMechBay.stateOffCount === 0,
          (building) => {
              if (building.cost["Supply"]) {
                  if (MechManager.isActive) {
                      return "Building mechs...";
                  }
                  let mechBay = game.global.portal.mechbay;
                  let newSize = !haveTask("mech") ? settings.mechBuild === "random" ? MechManager.getPreferredSize()[0] : mechBay.blueprint.size : "titan";
                  let [newGems, newSupply, newSpace] = MechManager.getMechCost({size: newSize});
                  if (newSpace <= mechBay.max - mechBay.bay && newSupply <= resources.Supply.maxQuantity && newGems <= resources.Soul_Gem.currentQuantity) {
                      return "Saving supplies for new mech";
                  }
              }
          },
          (note) => note,
          () => 0
      ],[
          () => settings.prestigeBioseedConstruct && settings.prestigeType === "ascension" && !game.global.race['witch_hunter'],
          (building) => building === buildings.GateEastTower || building === buildings.GateWestTower,
          () => "Not needed for Ascension prestige",
          () => 0
      ],[
          () => buildings.GateEastTower.isUnlocked() && buildings.GateWestTower.isUnlocked() && poly.hellSupression("gate").supress < settings.buildingTowerSuppression / 100,
          (building) => building === buildings.GateEastTower || building === buildings.GateWestTower,
          () => "Too low gate supression",
          () => 0
      ],[
          () => settings.prestigeType === "whitehole" && settings.prestigeWhiteholeSaveGems,
          (building) => {
              if (building.cost["Soul_Gem"] > resources.Soul_Gem.currentQuantity - 10) {
                  return true;
              }
          },
          () => "Saving up Soul Gems for prestige",
          () => 0
      ],[
          () => {
              return buildings.GorddonFreighter.isAutoBuildable() && buildings.GorddonFreighter.isAffordable(true) &&
                     buildings.Alien1SuperFreighter.isAutoBuildable() && buildings.Alien1SuperFreighter.isAffordable(true);
          },
          (building) => {
              if (building === buildings.GorddonFreighter || building === buildings.Alien1SuperFreighter) {
                  let regCount = buildings.GorddonFreighter.count;
                  let regTotal = (((1 + ((regCount + 1) * 0.03)) / (1 + ((regCount) * 0.03))) - 1);
                  let regCrew = regTotal / 3;
                  let supCount = buildings.Alien1SuperFreighter.count;
                  let supTotal = (((1 + ((supCount + 1) * 0.08)) / (1 + ((supCount) * 0.08))) - 1);
                  let supCrew = supTotal / 5;
                  if (building === buildings.GorddonFreighter && regCrew < supCrew) {
                      return buildings.Alien1SuperFreighter;
                  }
                  if (building === buildings.Alien1SuperFreighter && supCrew < regCrew) {
                      return buildings.GorddonFreighter;
                  }
              }
          },
          (other) => `${other.title} gives more Money`,
          () => settings.buildingsBestFreighter ? 0 : 1, // Find what's better - Freighter or Super Freighter
      ],[
          () => {
              return buildings.LakeBireme.isAutoBuildable() && buildings.LakeBireme.isAffordable(true) &&
                     buildings.LakeTransport.isAutoBuildable() && buildings.LakeTransport.isAffordable(true) &&
                     resources.Lake_Support.rateOfChange <= 1; // Build any if there's spare support
          },
          (building) => {
              if (building === buildings.LakeBireme || building === buildings.LakeTransport) {
                  let biremeCount = buildings.LakeBireme.count;
                  let transportCount = buildings.LakeTransport.count;
                  let rating = game.global.blood['spire'] && game.global.blood.spire >= 2 ? 0.8 : 0.85;
                  let nextBireme = (1 - (rating ** (biremeCount + 1))) * (transportCount * 5);
                  let nextTransport = (1 - (rating ** biremeCount)) * ((transportCount + 1) * 5);
                  if (settings.buildingsTransportGem) {
                      let currentSupply = (1 - (rating ** biremeCount)) * (transportCount * 5);
                      nextBireme = (nextBireme - currentSupply) / buildings.LakeBireme.cost["Soul_Gem"];
                      nextTransport = (nextTransport - currentSupply) / buildings.LakeTransport.cost["Soul_Gem"];
                  }
                  if (building === buildings.LakeBireme && nextBireme < nextTransport) {
                      return buildings.LakeTransport;
                  }
                  if (building === buildings.LakeTransport && nextTransport < nextBireme) {
                      return buildings.LakeBireme;
                  }
              }
          },
          (other) => `${other.title} gives more Supplies`,
          () => 0 // Find what's better - Bireme or Transport
      ],[
          () => {
              return buildings.SpirePort.isAutoBuildable() && buildings.SpirePort.isAffordable(true) &&
                     buildings.SpireBaseCamp.isAutoBuildable() && buildings.SpireBaseCamp.isAffordable(true);
          },
          (building) => {
              if (building === buildings.SpirePort || building === buildings.SpireBaseCamp) {
                  let portCount = buildings.SpirePort.count;
                  let baseCount = buildings.SpireBaseCamp.count;
                  let nextPort = (portCount + 1) * (1 + baseCount * 0.4);
                  let nextBase = portCount * (1 + (baseCount + 1) * 0.4);
                  if (building === buildings.SpirePort && nextPort < nextBase) {
                      return buildings.SpireBaseCamp;
                  }
                  if (building === buildings.SpireBaseCamp && nextBase < nextPort) {
                      return buildings.SpirePort;
                  }
              }
          },
          (other) => `${other.title} gives more Max Supplies`,
          () => 0 // Find what's better - Port or Base
        ],[
            () => {
                // Prioritizes building the best building during materials phase.
                // Active only during materials phase while mining pits are buildable - after that, just let it build whatever.
                // autoPower smart storage handling should always keep mining pits buildable until it's impossible
                return game.global.tech.tauceti && game.global.tech.tauceti <= 4 &&
                    buildings.TauOrbitalStation.isAutoBuildable() &&
                    buildings.TauColony.isAutoBuildable() &&
                    buildings.TauMiningPit.isAutoBuildable() && buildings.TauMiningPit.isAffordable(true);
            },
            (building) => {
                if (building === buildings.TauOrbitalStation || building === buildings.TauColony || building === buildings.TauMiningPit) {
                    let bestBuilding = null;
                    // TODO: rateOfChange seems wrong for Tau_Support?
                    let availSupport = Math.max(resources.Tau_Support.maxQuantity - resources.Tau_Support.currentQuantity, 0);
                    let nextPitPower = (buildings.TauMiningPit.count + 1) * (1 + (buildings.TauColony.count * 0.5));
                    let nextColonyPower = buildings.TauMiningPit.count * (1 + ((buildings.TauColony.count + 1) * 0.5));
                    // Best solution at the start: build a second and third mining pit, turn colony off. Special case but big speedup.
                    // HACK: Can't do this if missing support rule is set to 0 (it will make things worse in general)
                    if (buildings.TauMiningPit.count < 3 && settings.buildingWeightingMissingSupport > 0) {
                        bestBuilding = buildings.TauMiningPit;
                    }
                    // Need more mining pits for storage to build good buildings
                    else if (!buildings.TauOrbitalStation.isAffordable(true) || !buildings.TauColony.isAffordable(true)) {
                        bestBuilding = buildings.TauMiningPit;
                    }
                    // Colony needs 2 so we start building support if at exactly 1 support too
                    else if (nextColonyPower > nextPitPower) {
                        bestBuilding = (availSupport <= 1 && buildings.TauOrbitalStation.isAffordable(true)) ? buildings.TauOrbitalStation : buildings.TauColony;
                    }
                    else {
                        bestBuilding = (availSupport === 0 && buildings.TauOrbitalStation.isAffordable(true)) ? buildings.TauOrbitalStation : buildings.TauMiningPit;
                    }

                    return (bestBuilding === building) ? undefined : bestBuilding;
                }
            },
            (other) => `Best materials phase build: ${other.title}`,
            () => 0 // Handle Tau Ceti materials
      ],[
          () => haveTech("waygate", 2),
          (building) => building === buildings.SpireWaygate,
          () => "",
          () => 0 // We can't limit waygate using gameMax, as max here isn't constant. It start with 10, but after building count reduces down to 1
      ],[
          () => haveTech("hell_spire", 8),
          (building) => building === buildings.SpireSphinx,
          () => "",
          () => 0 // Sphinx not usable after solving
      ],[
          () => game.global.race['artifical'] && haveTech("focus_cure", 7),
          (building) => building instanceof ResourceAction && building.resource === resources.Population && building !== buildings.TauCloning,
          () => "Assembling is not possible",
          () => 0
      ],[
          () => game.global.race['artifical'],
          (building) => building instanceof ResourceAction && building.resource === resources.Population && resources.Population.storageRatio === 1,
          () => "No empty housings",
          () => 0
      ],[
          () => buildings.GorddonEmbassy.count === 0 && resources.Knowledge.maxQuantity < settings.fleetEmbassyKnowledge,
          (building) => building === buildings.GorddonEmbassy,
          () => `${getNumberString(settings.fleetEmbassyKnowledge)} Max Knowledge required`,
          () => 0
      ],[
          () => game.global.race['magnificent'] && settings.buildingShrineType !== "any",
          (building) => {
              if (building === buildings.Shrine) {
                  let bonus = null;
                  if (game.global.city.calendar.moon > 0 && game.global.city.calendar.moon < 7){
                      bonus = "morale";
                  } else if (game.global.city.calendar.moon > 7 && game.global.city.calendar.moon < 14){
                      bonus = "metal";
                  } else if (game.global.city.calendar.moon > 14 && game.global.city.calendar.moon < 21){
                      bonus = "know";
                  } else if (game.global.city.calendar.moon > 21){
                      bonus = "tax";
                  } else {
                      return true;
                  }
                  if (settings.buildingShrineType === "equally") {
                      let minShrine = Math.min(game.global.city.shrine.morale, game.global.city.shrine.metal, game.global.city.shrine.know, game.global.city.shrine.tax);
                      return game.global.city.shrine[bonus] !== minShrine;
                  } else {
                      return settings.buildingShrineType !== bonus;
                  }
              }
          },
          () => "Wrong shrine",
          () => 0
      ],[
          () => game.global.race['slaver'],
          (building) => {
              if (building === buildings.SlaveMarket) {
                  if (resources.Slave.currentQuantity >= resources.Slave.maxQuantity) {
                      return "Slave pens already full";
                  }
                  if (resources.Money.currentQuantity + resources.Money.rateOfChange < resources.Money.maxQuantity && resources.Money.rateOfChange < settings.slaveIncome){
                      return "Buying slaves only with excess money";
                  }
              }
          },
          (note) => note,
          () => 0 // Slave Market
      ],[
          () => game.global.race['cannibalize'],
          (building) => {
              if (building === buildings.SacrificialAltar && building.count > 0) {
                  if (resources.Population.currentQuantity < 1) {
                      return "Too low population";
                  }
                  if (resources.Population.currentQuantity !== resources.Population.maxQuantity) {
                      return "Sacrifices performed only with full population";
                  }
                  if (game.global.race['parasite'] && game.global.city.calendar.wind === 0) {
                      return "Parasites sacrificed only during windy weather";
                  }
                  if (game.global.civic[game.global.civic.d_job].workers < 1) {
                      return "No default workers to sacrifice";
                  }

                  if (game.global.city.s_alter.rage >= 3600 && game.global.city.s_alter.regen >= 3600 &&
                      game.global.city.s_alter.mind >= 3600 && game.global.city.s_alter.mine >= 3600 &&
                      (!isLumberRace() || game.global.city.s_alter.harvest >= 3600)){
                      return "Sacrifice bonus already high enough";
                  }
              }
          },
          (note) => note,
          () => 0 // Sacrificial Altar
      ],[
          () => true,
          (building) => building.getMissingConsumption(),
          (resource) => `Missing ${resource.name} to operate`,
          () => settings.buildingWeightingMissingSupply
      ],[
          () => true,
          (building) => building.getMissingSupport(),
          (support) => `Missing ${support.name} to operate`,
          () => settings.buildingWeightingMissingSupport
      ],[
          () => true,
          (building) => building.getUselessSupport(),
          (support) => `Provided ${support.name} not currently needed`,
          () => settings.buildingWeightingUselessSupport
      ],[
          () => game.global.race['truepath'] && resources.Tau_Belt_Support.maxQuantity <= resources.Tau_Belt_Support.currentQuantity,
          (building) => {
              if (building === buildings.TauBeltWhalingShip || building === buildings.TauBeltMiningShip) {
                  let s_max = resources.Tau_Belt_Support.maxQuantity;
                  let s_cur = resources.Tau_Belt_Support.currentQuantity;
                  let currentEff = 1-((1-(s_max/s_cur))**1.4);
                  let nextEff = 1-((1-(s_max/(s_cur+1)))**1.4);
                  return (nextEff*(s_cur+1))-(currentEff*s_cur);
              }
          },
          (eff) => `Low security, new ship will be ${getNiceNumber(eff * 100)}% efficient`,
          (eff) => eff ?? -1
      ],[
          () => game.global.race['truepath'], // "&& game.global.tech.tau_red === 4" doesn't want to work for some reason.
          (building) => {
              if (building === buildings.TauRedContact || building === buildings.TauRedIntroduce || building === buildings.TauRedSubjugate) {
                  let missing = null;
                  for (let [id, stat] of Object.entries({TauRedContact: "friend", TauRedIntroduce: "god", TauRedSubjugate: "lord"})) {
                      if (!game.global.stats.womling[stat][poly.universeAffix()]) {
                          if (building === buildings[id]) {
                              return false; // Unearned stat, go for it
                          }
                          if (buildings[id].isAutoBuildable()) {
                              missing = id;
                          }
                      }
                  }
                  return missing;
              }
          },
          (id) => `Overlord achievement is missing ${buildings[id].name}`,
          () => settings.buildingWeightingOverlord
      ],[
          () => true,
          (building) => building._tab === "city" && building !== buildings.Mill && building.stateOffCount > 0,
          () => "Still have some non operating buildings",
          () => settings.buildingWeightingNonOperatingCity
      ],[
          () => true,
          (building) => {
              if (building._tab !== "city" && building.stateOffCount > 0) {
                  if (building === buildings.RuinsGuardPost && building.isSmartManaged() && !isHellSupressUseful()
                    && building.count < Math.ceil(5000 / (game.armyRating(traitVal('high_pop', 0, 1), "hellArmy", 0) * traitVal('holy', 1, '+')))) { return false; }
                  if (building === buildings.BadlandsAttractor && building.isSmartManaged()) { return false; }
                  if (building === buildings.SpireMechBay && building.isSmartManaged()) { return false; }
                  let supplyIndex = building === buildings.SpirePort ? 1 : building === buildings.SpireBaseCamp ? 2 : -1;
                  if ((supplyIndex > 0 && (buildings.SpireMechBay.isSmartManaged() || buildings.SpirePurifier.isSmartManaged()))
                    && (building.count < getBestSupplyRatio(resources.Spire_Support.maxQuantity, buildings.SpirePort.autoMax, buildings.SpireBaseCamp.autoMax)[supplyIndex])) { return false; }
                  if (game.global.tech.tauceti && game.global.tech.tauceti <= 4 && (building === buildings.TauColony || building === buildings.TauMiningPit)) { return false; }
                  return true;
              }
          },
          () => "Still have some non operating buildings",
          () => settings.buildingWeightingNonOperating
      ],[
          () => settings.prestigeType !== "bioseed" || !isGECKNeeded(),
          (building) => building === buildings.GasSpaceDockGECK,
          () => "Max allowed amount of G.E.C.K reached",
          () => 0
      ],[
          () => game.global.race['lone_survivor'] && !isPrestigeAllowed("eden"),
          (building) => building === buildings.TauStarEden,
          () => "Prestiging not currently allowed",
          () => 0
      ],[
          () => game.global.race['truepath'] && (!isPrestigeAllowed("retire") || buildings.TauGas2MatrioshkaBrain.count < 1000),
          (building) => building === buildings.TauGas2IgniteGasGiant,
          () => "Prestiging not currently allowed",
          () => 0
      ],[
          () => settings.prestigeBioseedConstruct && settings.prestigeType !== "bioseed",
          (building) => building === buildings.GasSpaceDock || building === buildings.GasSpaceDockShipSegment || building === buildings.GasSpaceDockProbe,
          () => "Not needed for current prestige",
          () => 0
      ],[
          () => settings.prestigeBioseedConstruct && settings.prestigeType === "bioseed",
          (building) => building === buildings.DwarfWorldCollider || building === buildings.TitanMission,
          () => "Not needed for Bioseed prestige",
          () => 0
      ],[
          () => settings.prestigeBioseedConstruct && settings.prestigeType === "whitehole",
          (building) => building === buildings.BlackholeJumpShip,
          () => "Not needed for Whitehole prestige",
          () => 0
      ],[
          () => settings.prestigeBioseedConstruct && settings.prestigeType === "vacuum",
          (building) => building === buildings.BlackholeStellarEngine,
          () => "Not needed for Vacuum Collapse prestige",
          () => 0
      ],[
          () => settings.prestigeBioseedConstruct && settings.prestigeType === "ascension" && isPillarFinished() && !game.global.race['witch_hunter'],
          (building) => building === buildings.PitMission || building === buildings.RuinsMission,
          () => "Not needed for Ascension prestige",
          () => 0
      ],[
          () => game.global.race['witch_hunter'] && settings.prestigeType === "ascension",
          (building) => building === buildings.SpireWaygate,
          () => "Not needed for Witch Hunter's Ascension prestige",
          () => 0
      ],[
          () => settings.prestigeBioseedConstruct && settings.prestigeType === "terraform",
          (building) => building === buildings.PitMission || building === buildings.RuinsMission,
          () => "Not needed for Terraform prestige",
          () => 0
      ],[
          () => settings.autoPrestige && settings.prestigeType === "mad" && (haveTech("mad") || (techIds['tech-mad'].isUnlocked() && techIds['tech-mad'].isAffordable(true))),
          (building) => !building.is.housing && !building.is.garrison && !building.cost["Knowledge"] && building !== buildings.OilWell,
          () => "Awaiting MAD prestige",
          () => settings.buildingWeightingMADUseless
      ],[
          () => true,
          (building) => !(building instanceof ResourceAction) && building.count === 0,
          () => "New building",
          () => settings.buildingWeightingNew
      ],[
          () => resources.Power.isUnlocked() && resources.Power.currentQuantity < resources.Power.maxQuantity,
          (building) => building === buildings.LakeCoolingTower || building.powered < 0,
          () => "Need more energy",
          () => settings.buildingWeightingNeedfulPowerPlant
      ],[
          () => resources.Power.isUnlocked() && resources.Power.currentQuantity > resources.Power.maxQuantity,
          (building) => building !== buildings.Mill && (building === buildings.LakeCoolingTower || building.powered < 0),
          () => "No need for more energy",
          () => settings.buildingWeightingUselessPowerPlant
      ],[
          () => resources.Power.isUnlocked(),
          (building) => building !== buildings.LakeCoolingTower && building.powered > 0 && (building === buildings.NeutronCitadel ? getCitadelConsumption(building.count+1) - getCitadelConsumption(building.count) : building.powered) > resources.Power.currentQuantity,
          () => "Not enough energy",
          () => settings.buildingWeightingUnderpowered
      ],[
          () => state.knowledgeRequiredByTechs < resources.Knowledge.maxQuantity,
          (building) => building.is.knowledge && building !== buildings.Wardenclyffe, // We want Wardenclyffe for morale
          () => "No need for more knowledge",
          () => settings.buildingWeightingUselessKnowledge
      ],[
          () => state.knowledgeRequiredByTechs > resources.Knowledge.maxQuantity,
          (building) => building.is.knowledge,
          () => "Need more knowledge",
          () => settings.buildingWeightingNeedfulKnowledge
      ],[
          () => buildings.BlackholeMassEjector.count > 0 && buildings.BlackholeMassEjector.count * 1000 - game.global.interstellar.mass_ejector.total > 100,
          (building) => building === buildings.BlackholeMassEjector,
          () => "Still have some unused ejectors",
          () => settings.buildingWeightingUnusedEjectors
      ],[
          () => resources.Crates.storageRatio < 1 || resources.Containers.storageRatio < 1,
          (building) => building === buildings.StorageYard || building === buildings.Warehouse || building === buildings.EnceladusMunitions,
          () => "Still have some unused storage",
          () => settings.buildingWeightingCrateUseless
      ],[
          () => resources.Oil.maxQuantity < resources.Oil.maxCost && buildings.OilWell.count <= 0 && buildings.GasMoonOilExtractor.count <= 0,
          (building) => building === buildings.OilWell || building === buildings.GasMoonOilExtractor,
          () => "Need more fuel",
          () => settings.buildingWeightingMissingFuel
      ],[
          () => resources.Helium_3.maxQuantity < resources.Helium_3.maxCost || resources.Oil.maxQuantity < resources.Oil.maxCost,
          (building) => building === buildings.OilDepot || building === buildings.SpacePropellantDepot || building === buildings.GasStorage,
          () => "Need more fuel",
          () => settings.buildingWeightingMissingFuel
      ],[
          () => game.global.race.hooved && resources.Horseshoe.spareQuantity >= resources.Horseshoe.storageRequired,
          (building) => building instanceof ResourceAction && building.resource === resources.Horseshoe,
          () => "No more Horseshoes needed",
          () => settings.buildingWeightingHorseshoeUseless
      ],[
          () => game.global.race.calm && resources.Zen.currentQuantity < resources.Zen.maxQuantity,
          (building) => building === buildings.MeditationChamber,
          () => "No more Meditation Space needed",
          () => settings.buildingWeightingZenUseless
      ],[
          () => buildings.GateTurret.isUnlocked() && poly.hellSupression("gate").rating > (7501 + game.armyRating(traitVal('high_pop', 0, 1), "hellArmy", 0) * traitVal('holy', 1, '+')),
          (building) => building === buildings.GateTurret,
          () => "Gate demons fully supressed",
          () => settings.buildingWeightingGateTurret
      ],[
          () => (resources.Containers.isUnlocked() || resources.Crates.isUnlocked()) && resources.Containers.storageRatio === 1 && resources.Crates.storageRatio === 1,
          (building) => building === buildings.Shed || building === buildings.RedGarage || building === buildings.AlphaWarehouse || building === buildings.ProximaCargoYard || building === buildings.TitanStorehouse,
          () => "Need more storage",
          () => settings.buildingWeightingNeedStorage
      ],[
          () => resources.Population.maxQuantity > 50 && resources.Population.storageRatio < 0.9,
          (building) => building.is.housing && building !== buildings.Alien1Consulate && !(building instanceof ResourceAction),
          () => "No more houses needed",
          () => settings.buildingWeightingUselessHousing
      ],[
          () => game.global.race['orbit_decay'] && !game.global.race['orbit_decayed'],
          (building) => (building._tab === "city" || building._location === "spc_moon") && !(building instanceof ResourceAction),
          () => "Will be destroyed after impact",
          () => settings.buildingWeightingTemporal
      ],[
          () => true,
          (building) => building.is.random,
          () => "Randomized weighting",
          () => 1 + Math.random() // Fluctuate weight to pick random item
      ],[
          () => game.global.race['truepath'] && haveTech('tauceti', 2),
          (building) => (building._tab === "city" || building._tab === "space" || building._tab === "starDock") && !(building instanceof ResourceAction),
          () => "Solar System building",
          () => settings.buildingWeightingSolar
    ]];

    // Singleton manager objects
    var MinorTraitManager = {
        priorityList: [],
        _traitVueBinding: "geneticBreakdown",

        isUnlocked() {
            return haveTech("genetics", 3);
        },

        sortByPriority() {
            this.priorityList.sort((a, b) => a.priority - b.priority);
        },

        managedPriorityList() {
            return this.priorityList.filter(trait => trait.enabled && trait.isUnlocked());
        },

        buyTrait(traitName) {
            getVueById(this._traitVueBinding)?.gene(traitName);
        }
    }

    var MutableTraitManager = {
        priorityList: [],
        _traitVueBinding: "geneticBreakdown",

        isUnlocked() {
            return haveTech("genetics", 3) && game.global.genes['mutation'];
        },

        sortByPriority() {
            this.priorityList.sort((a, b) => a.priority - b.priority);
        },

        gainTrait(traitName) {
            getVueById(this._traitVueBinding)?.gain(traitName);
        },

        purgeTrait(traitName) {
            getVueById(this._traitVueBinding)?.purge(traitName);
        },

        get minimumPlasmidsToPreserve() {
            return Math.max(0, settings.minimumPlasmidsToPreserve, settings.doNotGoBelowPlasmidSoftcap ? resources.Phage.currentQuantity + 250 : 0);
        }
    }

    var QuarryManager = {
        _industryVueBinding: "iQuarry",
        _industryVue: undefined,

        initIndustry() {
            if (!game.global.race['smoldering'] || buildings.RockQuarry.count < 1) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        currentProduction() {
            return game.global.city.rock_quarry.asbestos;
        },

        increaseProduction(count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.decreaseProduction(count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.add();
            }
        },

        decreaseProduction(count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.increaseProduction(count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.sub();
            }
        }
    }

    var MineManager = {
        _industryVueBinding: "iTMine",
        _industryVue: undefined,

        initIndustry() {
            if (buildings.TitanMine.count < 1) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        currentProduction() {
            return game.global.space.titan_mine.ratio;
        },

        increaseProduction(count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.decreaseProduction(count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.add();
            }
        },

        decreaseProduction(count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.increaseProduction(count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.sub();
            }
        }
    }

    var ExtractorManager = {
        _industryVueBinding: "iMiningShip",
        _industryVue: undefined,

        initIndustry() {
            if (!haveTech("tau_roid", 4) || buildings.TauBeltMiningShip.count < 1) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        currentProduction(production) {
            return game.global.tauceti.mining_ship[production];
        },

        increaseProduction(production, count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.decreaseProduction(production, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.add(production);
            }
        },

        decreaseProduction(production, count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.increaseProduction(production, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.sub(production);
            }
        }
    }

    var NaniteManager = {
        _industryVueBinding: "iNFactory",
        _industryVue: undefined,
        storageShift: 1.005,
        priorityList: [],

        // export const nf_resources from industry.js
        Resources: [
            'Lumber', 'Chrysotile', 'Stone', 'Crystal', 'Furs', 'Copper', 'Iron', 'Aluminium',
            'Cement', 'Coal', 'Oil', 'Uranium', 'Steel', 'Titanium', 'Alloy', 'Polymer',
            'Iridium', 'Helium_3', 'Water', 'Deuterium', 'Neutronium', 'Adamantite', 'Bolognium', 'Orichalcum',
        ],

        resEnabled: (id) => settings['res_nanite' + id],

        isUnlocked() {
            return game.global.race['deconstructor'] && (buildings.NaniteFactory.count > 0 || buildings.RedNaniteFactory.count > 0 || buildings.TauNaniteFactory.count > 0);
        },

        isUseful() {
            return resources.Nanite.storageRatio < 1;
        },

        initIndustry() {
            if (!this.isUnlocked()) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        isConsumable(res) {
            return this.Resources.includes(res.id);
        },

        updateResources() {
            if (!this.isUnlocked() || !settings.autoNanite) {
                return;
            }
            for (let resource of this.priorityList) {
                if (resource.isUnlocked()) {
                    resource.rateMods['nanite'] = this.currentConsume(resource.id);
                    resource.rateOfChange += resource.rateMods['nanite'];
                }
            }
        },

        managedPriorityList() {
            return this.priorityList;
        },

        maxConsume() {
            return game.global.city.nanite_factory.count * 50;
        },

        currentConsume(id) {
            return game.global.city.nanite_factory[id];
        },

        useRatio() {
            switch (settings.naniteMode) {
                case "cap":
                    return [0.965];
                case "excess":
                    return [-1];
                case "all":
                    return [0.035];
                case "mixed":
                    return [0.965, -1];
                case "full":
                    return [0.965, -1, 0.035];
                default:
                    return [];
            }
        },

        maxConsumeCraftable(resource) {
            let extraIncome = resource.rateOfChange;
            let extraStore = resource.currentQuantity - (resource.storageRequired * this.storageShift);
            return Math.max(extraIncome, extraStore);
        },

        maxConsumeForRatio(resource, keepRatio) {
            let extraIncome = resource.rateOfChange;
            let extraStore = (resource.storageRatio - keepRatio) * resource.maxQuantity;
            return Math.max(extraIncome, extraStore);
        },

        consumeMore(id, count) {
            resources[id].rateMods['nanite'] += count;

            for (let m of KeyManager.click(count)) {
                this._industryVue.addItem(id);
            }
        },

        consumeLess(id, count) {
            resources[id].rateMods['nanite'] -= count;

            for (let m of KeyManager.click(count)) {
                this._industryVue.subItem(id);
            }
        }
    }

    var SupplyManager = {
        _supplyVuePrefix: "supply",
        storageShift: 1.010,
        priorityList: [],

        resEnabled: (id) => settings['res_supply' + id],

        isUnlocked() {
            return buildings.LakeTransport.count > 0;
        },

        isUseful() {
            return resources.Supply.storageRatio < 1 && buildings.LakeTransport.stateOnCount > 0 && buildings.LakeBireme.stateOnCount > 0;
        },

        initIndustry() {
            return this.isUnlocked();
        },

        isConsumable(res) {
            return poly.supplyValue.hasOwnProperty(res.id);
        },

        updateResources() {
            if (!this.isUnlocked() || !settings.autoSupply) {
                return;
            }
            for (let resource of this.priorityList) {
                if (resource.isUnlocked()) {
                    resource.rateMods['supply'] = this.currentConsume(resource.id) * this.supplyOut(resource.id);
                    resource.rateOfChange += resource.rateMods['supply'];
                }
            }
        },

        supplyIn(id) {
            return poly.supplyValue[id]?.in ?? 0;
        },

        supplyOut(id) {
            return poly.supplyValue[id]?.out ?? 0;
        },

        managedPriorityList() {
            return this.priorityList;
        },

        maxConsume() {
            return game.global.portal.transport.cargo.max;
        },

        currentConsume(id) {
            return game.global.portal.transport.cargo[id];
        },

        useRatio() {
            switch (settings.supplyMode) {
                case "cap":
                    return [0.975];
                case "excess":
                    return [-1];
                case "all":
                    return [0.045];
                case "mixed":
                    return [0.975, -1];
                case "full":
                    return [0.975, -1, 0.045];
                default:
                    return [];
            }
        },

        maxConsumeCraftable(resource) {
            let extraIncome = resource.calculateRateOfChange({buy: false, nanite: true});
            let extraStore = resource.currentQuantity - (resource.storageRequired * this.storageShift);
            return Math.max(extraIncome, extraStore) / this.supplyOut(resource.id);
        },

        maxConsumeForRatio(resource, keepRatio) {
            let extraIncome = resource.calculateRateOfChange({buy: false, nanite: true});
            let extraStore = (resource.storageRatio - keepRatio) * resource.maxQuantity;
            return Math.max(extraIncome, extraStore) / this.supplyOut(resource.id);
        },

        consumeMore(id, count) {
            let vue = getVueById(this._supplyVuePrefix + id);
            if (vue === undefined) { return false; }

            resources[id].rateMods['supply'] += (count * this.supplyOut(id));

            for (let m of KeyManager.click(count)) {
                vue.supplyMore(id);
            }
        },

        consumeLess(id, count) {
            let vue = getVueById(this._supplyVuePrefix + id);
            if (vue === undefined) { return false; }

            resources[id].rateMods['supply'] -= (count * this.supplyOut(id));

            for (let m of KeyManager.click(count)) {
                vue.supplyLess(id);
            }
        }
    }

    var EjectManager = {
        _ejectVuePrefix: "eject",
        storageShift: 1.015,
        priorityList: [],

        resEnabled: (id) => settings['res_eject' + id],

        isUnlocked() {
            return buildings.BlackholeMassEjector.count > 0;
        },

        isUseful() {
            return true; // Never stop ejecting
        },

        initIndustry() {
            return this.isUnlocked();
        },

        isConsumable(res) {
            return game.atomic_mass.hasOwnProperty(res.id);
        },

        updateResources() {
            if (!this.isUnlocked() || (!settings.autoEject && !haveTask("trash"))) {
                return;
            }
            for (let resource of this.priorityList) {
                if (resource.isUnlocked()) {
                    resource.rateMods['eject'] = this.currentConsume(resource.id);
                    resource.rateOfChange += resource.rateMods['eject'];
                }
            }
        },

        managedPriorityList() {
            return !game.global.race['artifical'] ? this.priorityList
              : this.priorityList.filter(r => r !== resources.Food);
        },

        maxConsume() {
            return game.global.interstellar.mass_ejector.on * 1000;
        },

        currentConsume(id) {
            return game.global.interstellar.mass_ejector[id];
        },

        useRatio() {
            switch (settings.ejectMode) {
                case "cap":
                    return [0.985];
                case "excess":
                    return [-1];
                case "all":
                    return [0.055];
                case "mixed":
                    return [0.985, -1];
                case "full":
                    return [0.985, -1, 0.055];
                default:
                    return [];
            }
        },

        maxConsumeCraftable(resource) {
            let extraIncome = resource.calculateRateOfChange({buy: false, supply: true, nanite: true});
            let extraStore = resource.currentQuantity - (resource.storageRequired * this.storageShift);
            return Math.max(extraIncome, extraStore);
        },

        maxConsumeForRatio(resource, keepRatio) {
            let extraIncome = resource.calculateRateOfChange({buy: false, supply: true, nanite: true});
            let extraStore = (resource.storageRatio - keepRatio) * resource.maxQuantity;
            return Math.max(extraIncome, extraStore);
        },

        consumeMore(id, count) {
            let vue = getVueById(this._ejectVuePrefix + id);
            if (vue === undefined) { return false; }

            resources[id].rateMods['eject'] += count;

            for (let m of KeyManager.click(count)) {
                vue.ejectMore(id);
            }
        },

        consumeLess(id, count) {
            let vue = getVueById(this._ejectVuePrefix + id);
            if (vue === undefined) { return false; }

            resources[id].rateMods['eject'] -= count;

            for (let m of KeyManager.click(count)) {
                vue.ejectLess(id);
            }
        }
    }

    var AlchemyManager = {
        _alchemyVuePrefix: "alchemy",
        priorityList: [],

        resEnabled: id => settings['res_alchemy_' + id],
        resWeighting: id => settings['res_alchemy_w_' + id],

        isUnlocked() {
            return haveTech('alchemy');
        },

        managedPriorityList() {
            return this.priorityList.filter(res => this.resEnabled(res.id) && res.isUnlocked() && this.transmuteTier(res) <= game.global.tech.alchemy && (!game.global.race['artifical'] || res !== resources.Food));
        },

        transmuteTier(res) {
            return !game.tradeRatio.hasOwnProperty(res.id) || res === resources.Crystal ? 0 :
                   res.instance?.hasOwnProperty("trade") ? 1 : 2;
        },

        currentCount(id) {
            return game.global.race.alchemy[id];
        },

        transmuteMore(id, count) {
            let vue = getVueById(this._alchemyVuePrefix + id);
            if (vue === undefined) { return false; }

            resources.Mana.rateOfChange -= count * 1;
            resources.Crystal.rateOfChange -= count * 0.5;

            for (let m of KeyManager.click(count)) {
                vue.addSpell(id);
            }
        },

        transmuteLess(id, count) {
            let vue = getVueById(this._alchemyVuePrefix + id);
            if (vue === undefined) { return false; }

            resources.Mana.rateOfChange += count * 1;
            resources.Crystal.rateOfChange += count * 0.5;

            for (let m of KeyManager.click(count)) {
                vue.subSpell(id);
            }
        }
    }

    var RitualManager = {
        _industryVueBinding: "iPylon",
        _industryVue: undefined,

        Productions: addProps({
            Farmer: {id: 'farmer', isUnlocked: () => !game.global.race['orbit_decayed'] && !game.global.race['cataclysm'] && !game.global.race['carnivore'] && !game.global.race['soul_eater'] && !game.global.race['artifical'] && !game.global.race['unfathomable']},
            Miner: {id: 'miner', isUnlocked: () => !game.global.race['cataclysm']},
            Lumberjack: {id: 'lumberjack', isUnlocked: () => !game.global.race['orbit_decayed'] && !game.global.race['cataclysm'] && isLumberRace() && !game.global.race['evil']},
            Science: {id: 'science', isUnlocked: () => true},
            Factory: {id: 'factory', isUnlocked: () => true},
            Army: {id: 'army', isUnlocked: () => true},
            Hunting: {id: 'hunting', isUnlocked: () => true},
            Crafting: {id: 'crafting', isUnlocked: () => haveTech("magic", 4)},
        }, (s) => s.id, [{s: 'spell_w_', p: "weighting"}]),

        initIndustry() {
            if ((buildings.Pylon.count < 1 && buildings.RedPylon.count < 1 && buildings.TauPylon.count < 1) || !game.global.race['casting']) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        currentSpells(spell) {
            return game.global.race.casting[spell.id];
        },

        spellCost(spell) {
            return this.manaCost(this.currentSpells(spell));
        },

        costStep(level) {
            if (level === 0) {
                return 0.0025;
            }
            let cost = this.manaCost(level);
            return ((cost / level * 1.0025 + 0.0025) * (level + 1)) - cost;
        },

        // export function manaCost(spell,rate) from industry.js
        manaCost(level) {
            return level * ((1.0025) ** level - 1);
        },

        increaseRitual(spell, count) {
            if (count === 0 || !spell.isUnlocked()) {
                return false;
            }
            if (count < 0) {
                return this.decreaseRitual(spell, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.addSpell(spell.id);
            }
        },

        decreaseRitual(spell, count) {
            if (count === 0 || !spell.isUnlocked()) {
                return false;
            }
            if (count < 0) {
                return this.increaseRitual(count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.subSpell(spell.id);
            }
        }
    }

    var SmelterManager = {
        _industryVueBinding: "iSmelter",
        _industryVue: undefined,

        Productions: normalizeProperties({
            Iron: {id: "Iron", unlocked: () => true, resource: resources.Iron, cost: []},
            Steel: {id: "Steel", unlocked: () => resources.Steel.isUnlocked() && haveTech("smelting", 2), resource: resources.Steel,
                    cost: [new ResourceProductionCost(resources.Coal, 0.25, 1.25), new ResourceProductionCost(resources.Iron, 2, 6)]},
            Iridium: {id: "Iridium", unlocked: () => resources.Iridium.isUnlocked() && (haveTech("m_smelting", 2) || haveTech("irid_smelting")), resource: resources.Iridium, cost: []},
        }, [ResourceProductionCost]),

        Fuels: addProps(normalizeProperties({
            Oil: {id: "Oil", unlocked: () => game.global.resource.Oil.display, cost: [new ResourceProductionCost(resources.Oil, 0.35, 2)]},
            Coal: {id: "Coal", unlocked: () => game.global.resource.Coal.display, cost: [new ResourceProductionCost(resources.Coal, () => !isLumberRace() ? 0.15 : 0.25, 2)]},
            Wood: {id: "Wood", unlocked: () => isLumberRace() || game.global.race['evil'], cost: [new ResourceProductionCost(() => game.global.race['evil'] ? game.global.race['soul_eater'] && game.global.race.species !== 'wendigo' ? resources.Food : resources.Furs : resources.Lumber, () => game.global.race['evil'] && !game.global.race['soul_eater'] || game.global.race.species === 'wendigo' ? 1 : 3, 6)]},
            Inferno: {id: "Inferno", unlocked: () => haveTech("smelting", 8), cost: [new ResourceProductionCost(resources.Coal, 50, 50), new ResourceProductionCost(resources.Oil, 35, 50), new ResourceProductionCost(resources.Infernite, 0.5, 50)]},
        }, [ResourceProductionCost]), (f) => f.id, [{s: "smelter_fuel_p_", p: "priority"}]),

        initIndustry() {
            if (game.global.race['steelen'] || (buildings.Smelter.count < 1 && !game.global.race['cataclysm'] && !game.global.race['orbit_decayed'] && !haveTech("isolation"))) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        managedFuelPriorityList() {
            return Object.values(this.Fuels).sort((a, b) => a.priority - b.priority);
        },

        fueledCount(fuel) {
            if (!fuel.unlocked) {
                return 0;
            }

            return game.global.city.smelter[fuel.id];
        },

        smeltingCount(production) {
            if (!production.unlocked) {
                return 0;
            }

            return game.global.city.smelter[production.id];
        },

        increaseFuel(fuel, count) {
            if (count === 0 || !fuel.unlocked) {
                return false;
            }
            if (count < 0) {
                return this.decreaseFuel(fuel, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.addFuel(fuel.id);
            }
        },

        decreaseFuel(fuel, count) {
            if (count === 0 || !fuel.unlocked) {
                return false;
            }
            if (count < 0) {
                return this.increaseFuel(fuel, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.subFuel(fuel.id);
            }
        },

        increaseSmelting(id, count) {
            if (count === 0 || !this.Productions[id].unlocked) {
                return false;
            }
            if (count < 0) {
                return this.decreaseSmelting(id, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.addMetal(id);
            }
        },

        decreaseSmelting(id, count) {
            if (count === 0 || !this.Productions[id].unlocked) {
                return false;
            }
            if (count < 0) {
                return this.increaseSmelting(id, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.subMetal(id);
            }
        },

        maxOperating() {
            return game.global.city.smelter.cap - game.global.city.smelter.Star;
        },

        extraOperating() {
            return game.global.city.smelter.Star;
        },

        currentFueled() {
            return this._industryVue.$options.filters.on();
        }
    }

    var FactoryManager = {
        _industryVueBinding: "iFactory",
        _industryVue: undefined,

        Productions: addProps(normalizeProperties({
            LuxuryGoods:          {id: "Lux", resource: resources.Money, unlocked: () => true,
                                   cost: [new ResourceProductionCost(resources.Furs, () => FactoryManager.f_rate("Lux", "fur"), 5)]},
            Furs:                 {id: "Furs", resource: resources.Furs, unlocked: () => haveTech("synthetic_fur"),
                                   cost: [new ResourceProductionCost(resources.Money, () => FactoryManager.f_rate("Furs", "money"), 1000),
                                          new ResourceProductionCost(resources.Polymer, () => FactoryManager.f_rate("Furs", "polymer"), 10)]},
            Alloy:                {id: "Alloy", resource: resources.Alloy, unlocked: () => true,
                                   cost: [new ResourceProductionCost(resources.Copper, () => FactoryManager.f_rate("Alloy", "copper"), 5),
                                          new ResourceProductionCost(resources.Aluminium, () => FactoryManager.f_rate("Alloy", "aluminium"), 5)]},
            Polymer:              {id: "Polymer", resource: resources.Polymer, unlocked: () => haveTech("polymer"),
                                   cost: function(){ return !isLumberRace() ? this.cost_kk : this.cost_normal},
                                   cost_kk:       [new ResourceProductionCost(resources.Oil, () => FactoryManager.f_rate("Polymer", "oil_kk"), 2)],
                                   cost_normal:   [new ResourceProductionCost(resources.Oil, () => FactoryManager.f_rate("Polymer", "oil"), 2),
                                                   new ResourceProductionCost(resources.Lumber, () => FactoryManager.f_rate("Polymer", "lumber"), 50)]},
            NanoTube:             {id: "Nano", resource: resources.Nano_Tube, unlocked: () => haveTech("nano"),
                                   cost: [new ResourceProductionCost(resources.Coal, () => FactoryManager.f_rate("Nano_Tube", "coal"), 15),
                                          new ResourceProductionCost(resources.Neutronium, () => FactoryManager.f_rate("Nano_Tube", "neutronium"), 0.2)]},
            Stanene:              {id: "Stanene", resource: resources.Stanene, unlocked: () => haveTech("stanene"),
                                   cost: [new ResourceProductionCost(resources.Aluminium, () => FactoryManager.f_rate("Stanene", "aluminium"), 50),
                                          new ResourceProductionCost(resources.Nano_Tube, () => FactoryManager.f_rate("Stanene", "nano"), 5)]},
        }, [ResourceProductionCost]), (p) => p.resource.id,
          [{s: 'production_', p: "enabled"},
           {s: 'production_w_', p: "weighting"},
           {s: 'production_p_', p: "priority"}]),

        initIndustry() {
            if (buildings.Factory.count < 1 && buildings.RedFactory.count < 1 && buildings.TauFactory.count < 1) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }
            return true;
        },

        f_rate(production, resource) {
            return game.f_rate[production][resource][game.global.tech['factory'] || 0];
        },

        currentOperating() {
            let total = 0;
            for (let key in this.Productions) {
                let production = this.Productions[key];
                total += game.global.city.factory[production.id];
            }
            return total;
        },

        maxOperating() {
            let max = buildings.Factory.stateOnCount
                    + buildings.RedFactory.stateOnCount
                    + buildings.AlphaMegaFactory.stateOnCount * 2
                    + buildings.TauFactory.stateOnCount * (haveTech("isolation") ? 5 : 3);
            for (let key in this.Productions) {
                let production = this.Productions[key];
                if (production.unlocked && !production.enabled) {
                    max -= game.global.city.factory[production.id];
                }
            }
            return max;
        },

        currentProduction(production) {
            return production.unlocked ? game.global.city.factory[production.id] : 0;
        },

        increaseProduction(production, count) {
            if (count === 0 || !production.unlocked) {
                return false;
            }
            if (count < 0) {
                return this.decreaseProduction(production, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.addItem(production.id);
            }
        },

        decreaseProduction(production, count) {
            if (count === 0 || !production.unlocked) {
                return false;
            }
            if (count < 0) {
                return this.increaseProduction(production, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.subItem(production.id);
            }
        }
    }

    var ReplicatorManager = {
        _industryVueBinding: "iReplicator",
        _industryVue: undefined,

        Productions: addProps(normalizeProperties(
            replicableResources.map(resId => resources[resId]).reduce((a, res) => ({ ...a, [res.id]: {id: res.id, resource: res, unlocked: () => res.isUnlocked(), cost: []}}), {})),
            (p) => p.resource.id,
          [{s: 'replicator_', p: "enabled"},
           {s: 'replicator_w_', p: "weighting"},
           {s: 'replicator_p_', p: "priority"}]),

        initIndustry() {
            if (!haveTech('replicator')) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }
            return true;
        },

        setResource(res) {
            if (this._industryVue.avail(res)) {
                this._industryVue.setVal(res);
            }
        }
    }

    var DroidManager = {
        _industryVueBinding: "iDroid",
        _industryVue: undefined,

        Productions: addProps({
            Adamantite: {id: "adam", resource: resources.Adamantite},
            Uranium: {id: "uran", resource: resources.Uranium},
            Coal: {id: "coal", resource: resources.Coal},
            Aluminium: {id: "alum", resource: resources.Aluminium},
        }, (p) => p.resource.id,
          [{s: 'droid_w_', p: "weighting"},
           {s: 'droid_pr_', p: "priority"}]),

        initIndustry() {
            if (buildings.AlphaMiningDroid.count < 1) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        currentOperating() {
            let total = 0;
            for (let key in this.Productions) {
                let production = this.Productions[key];
                total += game.global.interstellar.mining_droid[production.id];
            }
            return total;
        },

        maxOperating() {
            return game.global.interstellar.mining_droid.on;
        },

        currentProduction(production) {
            return game.global.interstellar.mining_droid[production.id];
        },

        increaseProduction(production, count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.decreaseProduction(production, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.addItem(production.id);
            }
        },

        decreaseProduction(production, count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.increaseProduction(production, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.subItem(production.id);
            }
        }
    }

    var GrapheneManager = {
        _industryVueBinding: "iGraphene",
        _industryVue: undefined,
        _graphPlant: null,

        Fuels: {
            Lumber: {id: "Lumber", cost: new ResourceProductionCost(resources.Lumber, 350, 100), add: "addWood", sub: "subWood"},
            Coal: {id: "Coal", cost: new ResourceProductionCost(resources.Coal, 25, 10), add: "addCoal", sub: "subCoal"},
            Oil: {id: "Oil", cost: new ResourceProductionCost(resources.Oil, 15, 10), add: "addOil", sub: "subOil"},
        },

        initIndustry() {
            this._graphPlant = game.global.race['truepath'] ? buildings.TitanGraphene : buildings.AlphaGraphenePlant;
            if ((this._graphPlant.instance?.count ?? 0) < 1) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        maxOperating() {
            return this._graphPlant.instance.on;
        },

        fueledCount(fuel) {
            return this._graphPlant.instance[fuel.id];
        },

        increaseFuel(fuel, count) {
            if (count === 0 || !fuel.cost.resource.isUnlocked()) {
                return false;
            }
            if (count < 0) {
                return this.decreaseFuel(fuel, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue[fuel.add]();
            }
        },

        decreaseFuel(fuel, count) {
            if (count === 0 || !fuel.cost.resource.isUnlocked()) {
                return false;
            }
            if (count < 0) {
                return this.increaseFuel(fuel, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue[fuel.sub]();
            }
        }
    }

    var GalaxyTradeManager = {
        _industryVueBinding: "galaxyTrade",
        _industryVue: undefined,

        initIndustry() {
            if (buildings.GorddonFreighter.count + buildings.Alien1SuperFreighter.count < 1) {
                return false;
            }

            this._industryVue = getVueById(this._industryVueBinding);
            if (this._industryVue === undefined) {
                return false;
            }

            return true;
        },

        currentOperating() {
            return game.global.galaxy.trade.cur;
        },

        maxOperating() {
            return game.global.galaxy.trade.max;
        },

        currentProduction(production) {
            return game.global.galaxy.trade["f" + production];
        },

        zeroProduction(production) {
            this._industryVue.zero(production);
        },

        increaseProduction(production, count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.decreaseProduction(production, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.more(production);
            }
        },

        decreaseProduction(production, count) {
            if (count === 0) {
                return false;
            }
            if (count < 0) {
                return this.increaseProduction(production, count * -1);
            }

            for (let m of KeyManager.click(count)) {
                this._industryVue.less(production);
            }
        }
    }

    var GovernmentManager = {
        Types: {
            anarchy: {id: "anarchy", isUnlocked: () => false}, // Special - should not be shown to player
            autocracy: {id: "autocracy", isUnlocked: () => true},
            democracy: {id: "democracy", isUnlocked: () => true},
            oligarchy: {id: "oligarchy", isUnlocked: () => true},
            theocracy: {id: "theocracy", isUnlocked: () => haveTech("gov_theo")},
            republic: {id: "republic", isUnlocked: () => haveTech("govern", 2)},
            socialist: {id: "socialist", isUnlocked: () => haveTech("gov_soc")},
            corpocracy: {id: "corpocracy", isUnlocked: () => haveTech("gov_corp")},
            technocracy: {id: "technocracy", isUnlocked: () => haveTech("govern", 3)},
            federation: {id: "federation", isUnlocked: () => haveTech("gov_fed")},
            magocracy: {id: "magocracy", isUnlocked: () => haveTech("gov_mage")},
        },

        isUnlocked() {
            let node = document.getElementById("govType");
            return node !== null && node.style.display !== "none";
        },

        isEnabled() {
            let node = document.querySelector("#govType button");
            return this.isUnlocked() && node !== null && node.getAttribute("disabled") !== "disabled";
        },

        currentGovernment() {
            return game.global.civic.govern.type;
        },

        setGovernment(government) {
            // Don't try anything if chosen government already set, or modal window is already open
            if (this.currentGovernment() === government || WindowManager.isOpen()) {
                return;
            }

            let optionsNode = document.querySelector("#govType button");
            let title = game.loc('civics_government_type');
            WindowManager.openModalWindowWithCallback(optionsNode, title, () => {
                GameLog.logSuccess("special", `Revolution! Government changed to ${game.loc("govern_" + government)}.`, ['events', 'major_events']);
                getVueById('govModal')?.setGov(government);
            });
        },
    }

    var MarketManager = {
        priorityList: [],
        multiplier: 0,

        updateData() {
            if (game.global.city.market) {
                this.multiplier = game.global.city.market.qty;
            }
        },

        isUnlocked() {
            return haveTech("currency", 2);
        },

        sortByPriority() {
            this.priorityList.sort((a, b) => a.marketPriority - b.marketPriority);
        },

        isBuySellUnlocked(resource) {
            return document.querySelector("#market-" + resource.id + " .order") !== null;
        },

        setMultiplier(multiplier) {
            this.multiplier = Math.min(Math.max(1, multiplier), this.getMaxMultiplier());

            getVueById("market-qty").qty = this.multiplier;
        },

        getMaxMultiplier(){
            return getVueById("market-qty")?.limit() ?? 1;
        },

        getUnitBuyPrice(resource) {
            // marketItem > vBind > purchase from resources.js
            let price = game.global.resource[resource.id].value;

            price *= traitVal('arrogant', 0, '+');
            price *= traitVal('conniving', 0, '-');

            return price;
        },

        getUnitSellPrice(resource) {
            // marketItem > vBind > sell from resources.js
            let divide = 4;

            divide *= traitVal('merchant', 0, '-');
            divide *= traitVal('asymmetrical', 0, '+');
            divide *= traitVal('conniving', 1, '-');

            return game.global.resource[resource.id].value / divide;
        },

        buy(resource) {
            let vue = getVueById(resource._marketVueBinding);
            if (vue === undefined) { return false; }

            let price = this.getUnitBuyPrice(resource) * this.multiplier;
            if (resources.Money.currentQuantity < price) { return false; }

            resources.Money.currentQuantity -= this.multiplier * this.getUnitBuyPrice(resource);
            resource.currentQuantity += this.multiplier;

            vue.purchase(resource.id);
        },

        sell(resource) {
            let vue = getVueById(resource._marketVueBinding);
            if (vue === undefined) { return false; }

            if (resource.currentQuantity < this.multiplier) { return false; }

            resources.Money.currentQuantity += this.multiplier * this.getUnitSellPrice(resource);
            resource.currentQuantity -= this.multiplier;

            vue.sell(resource.id);
        },

        getImportRouteCap() {
            if (haveTech("currency", 6)){
                return 1000000;
            } else if (haveTech("currency", 4)){
                return 100;
            } else {
                return 25;
            }
        },

        getExportRouteCap() {
            if (!game.global.race['banana']){
                return this.getImportRouteCap();
            } else if (haveTech("currency", 6)){
                return 1000000;
            } else if (haveTech("currency", 4)){
                return 25;
            } else {
                return 10;
            }
        },

        getMaxTradeRoutes() {
            let max = game.global.city.market.mtrade;
            let unmanaged = 0;
            for (let resource of this.priorityList) {
                if (!resource.autoTradeBuyEnabled && !resource.autoTradeSellEnabled) {
                    max -= Math.abs(resource.tradeRoutes);
                    unmanaged += resource.tradeRoutes;
                }
            }
            return [max, unmanaged];
        },

        zeroTradeRoutes(resource) {
            getVueById(resource._marketVueBinding)?.zero(resource.id);
        },

        addTradeRoutes(resource, count) {
            if (!resource.isUnlocked()) { return false; }

            let vue = getVueById(resource._marketVueBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.autoBuy(resource.id);
            }
        },

        removeTradeRoutes(resource, count) {
            if (!resource.isUnlocked()) { return false; }

            let vue = getVueById(resource._marketVueBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.autoSell(resource.id);
            }
        }
    }

    var StorageManager = {
        priorityList: [],
        crateValue: 0,
        containerValue: 0,
        _storageVueBinding: "createHead",
        _storageVue: undefined,

        initStorage() {
            if (!this.isUnlocked) {
                return false;
            }

            this._storageVue = getVueById(this._storageVueBinding);
            if (this._storageVue === undefined) {
                return false;
            }

            return true;
        },

        isUnlocked() {
            return haveTech("container");
        },

        sortByPriority() {
            this.priorityList.sort((a, b) => a.storagePriority - b.storagePriority);
        },

        constructCrate(count) {
            if (count <= 0) {
                return;
            }
            for (let m of KeyManager.click(count)) {
                this._storageVue.crate();
            }
        },

        constructContainer(count) {
            if (count <= 0) {
                return;
            }
            for (let m of KeyManager.click(count)) {
                this._storageVue.container();
            }
        },

        assignCrate(resource, count) {
            let vue = getVueById(resource._stackVueBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.addCrate(resource.id);
            }
        },

        unassignCrate(resource, count) {
            let vue = getVueById(resource._stackVueBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.subCrate(resource.id);
            }
        },

        assignContainer(resource, count) {
            let vue = getVueById(resource._stackVueBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.addCon(resource.id);
            }
        },

        unassignContainer(resource, count) {
            let vue = getVueById(resource._stackVueBinding);
            if (vue === undefined) { return false; }

            for (let m of KeyManager.click(count)) {
                vue.subCon(resource.id);
            }
        }
    }

    var SpyManager = {
        _foreignVue: undefined,

        purchaseMoney: 0,
        purchaseForeigngs: [],
        foreignActive: [],
        foreignTarget: null,

        Types: {
            Influence: {id: "influence"},
            Sabotage: {id: "sabotage"},
            Incite: {id: "incite"},
            Annex: {id: "annex"},
            Purchase: {id: "purchase"},
        },

        spyCost(govIndex, spy) {
            let gov = game.global.civic.foreign[`gov${govIndex}`];
            spy = spy ?? gov.spy + 1;

            let base = Math.max(50, Math.round((gov.mil / 2) + (gov.hstl / 2) - gov.unrest) + 10);
            if (game.global.race['infiltrator']){
                base /= 3;
            }
            if (state.astroSign === 'scorpio') {
                base * 0.88;
            }
            return Math.round(base ** spy) + 500;
        },

        updateForeigns() {
            this.purchaseMoney = 0;
            this.purchaseForeigngs = [];
            this._foreignVue = getVueById("foreign");
            let foreignUnlocked = this._foreignVue?.vis();
            if (foreignUnlocked) {
                let currentTarget = null;
                let controlledForeigns = 0;
                let pendingControlledForeigns = 0;

                let unlockedForeigns = [];
                if (!haveTech("world_control")) {
                    unlockedForeigns.push(0, 1, 2);
                }
                if (haveTech("rival")) {
                    unlockedForeigns.push(3);
                }

                let activeForeigns = unlockedForeigns.map(i => ({id: i, gov: game.global.civic.foreign[`gov${i}`]}));

                // Init foreigns
                for (let foreign of activeForeigns) {
                    let rank = foreign.id === 3 ? "Rival" :
                      getGovPower(foreign.id) <= settings.foreignPowerRequired ? "Inferior" :
                      "Superior";

                    foreign.policy = settings[`foreignPolicy${rank}`];

                    if ((foreign.gov.anx && foreign.policy === "Annex") ||
                        (foreign.gov.buy && foreign.policy === "Purchase") ||
                        (foreign.gov.occ && foreign.policy === "Occupy")) {
                        controlledForeigns++;
                    }
                    else if (["purchase", "annex"].includes(foreign.gov.act) && foreign.gov.sab > 0) {
                        pendingControlledForeigns++;
                    }

                    if (!settings.foreignPacifist && !foreign.gov.anx && !foreign.gov.buy && rank === "Inferior") {
                        currentTarget = foreign;
                    }
                }

                let allowOccupy = (game.global.tech['unify'] === 1 || settings.foreignForceOccupy);
                // Adjust for fight
                if (activeForeigns.length > 0 && !settings.foreignPacifist) {
                    // Try to attacks last uncontrolled inferior, or first occupied, or just first, in this order.
                    currentTarget = currentTarget ?? activeForeigns.find(f => f.gov.occ) ?? activeForeigns[0];

                    let readyToUnify = settings.foreignUnification && (controlledForeigns+pendingControlledForeigns) >= 2 && allowOccupy;

                    // Don't annex or purchase our farm target, unless we're ready to unify
                    if (!readyToUnify && ["Annex", "Purchase"].includes(currentTarget.policy) && SpyManager.isEspionageUseful(currentTarget.id, SpyManager.Types[currentTarget.policy].id)) {
                        currentTarget.policy = "Ignore";
                    }

                    // Don't occupy our farm target if we're ready to unify, but still waiting on the timer for other nations
                    if (readyToUnify && pendingControlledForeigns > 0 && currentTarget.policy === "Occupy") {
                        currentTarget.policy = "Ignore";
                    }

                    // Force sabotage, if needed, and we know it's useful
                    if (!readyToUnify && settings.foreignForceSabotage && currentTarget.id !== 3 && SpyManager.isEspionageUseful(currentTarget.id, SpyManager.Types.Sabotage.id)) {
                        currentTarget.policy = "Sabotage";
                    }

                    // Set last foreign to sabotage only, and then switch to occupy once we're ready to unify
                    if (settings.foreignUnification && settings.foreignOccupyLast && !haveTech('world_control')) {
                        let lastTarget = ["Occupy", "Sabotage"].includes(settings.foreignPolicySuperior) ? 2 : currentTarget.id;
                        activeForeigns[lastTarget].policy = readyToUnify ? "Occupy" : "Sabotage";
                    }

                    // Do not attack if policy set to influence, or we're ready to unify
                    if (currentTarget.policy === "Influence" || (readyToUnify && currentTarget.policy !== "Occupy") || (currentTarget.policy === "Betrayal" && currentTarget.gov.mil > 75)) {
                        currentTarget = null;
                    }
                }

                // Request money for unify, make sure we have autoFight and autoResearch
                if (allowOccupy && settings.foreignUnification && settings.autoFight) {
                    for (let foreign of activeForeigns) {
                        if (foreign.policy === "Purchase" && !foreign.gov.buy && foreign.gov.act !== "purchase") {
                            let moneyNeeded = Math.max(poly.govPrice(foreign.id), (foreign.gov.spy < 3 ? this.spyCost(foreign.id, 3) : 0));
                            if (moneyNeeded <= resources.Money.maxQuantity) {
                                this.purchaseForeigngs.push(foreign.id);
                                this.purchaseMoney = Math.max(moneyNeeded, this.purchaseMoney);
                            }
                        }
                    }
                }

                this.foreignTarget = currentTarget;
                this.foreignActive = activeForeigns;
            } else {
                this._foreignVue = undefined;
            }
        },

        performEspionage(govIndex, espionageId, influenceAllowed) {
            if (WindowManager.isOpen()) { return; } // Don't try anything if a window is already open

            let optionsSpan = document.querySelector(`#gov${govIndex} div span:nth-child(3)`);
            if (optionsSpan.style.display === "none") { return; }

            let optionsNode = document.querySelector(`#gov${govIndex} div span:nth-child(3) button`);
            if (optionsNode === null || optionsNode.getAttribute("disabled") === "disabled") { return; }

            let espionageToPerform = null;
            if (espionageId === this.Types.Annex.id || espionageId === this.Types.Purchase.id) {
                // Occupation routine
                if (this.isEspionageUseful(govIndex, espionageId)) {
                    // If we can annex\purchase right now - do it
                    espionageToPerform = espionageId;
                } else if (this.isEspionageUseful(govIndex, this.Types.Influence.id) && influenceAllowed) {
                    // Influence goes second, as it always have clear indication when HSTL already at zero
                    espionageToPerform = this.Types.Influence.id;
                } else if (this.isEspionageUseful(govIndex, this.Types.Incite.id)) {
                    // And now incite
                    espionageToPerform = this.Types.Incite.id;
                }
            } else if (this.isEspionageUseful(govIndex, espionageId)) {
                // User specified spy operation. If it is not already at miximum effect then proceed with it.
                espionageToPerform = espionageId;
            }

            if (espionageToPerform !== null) {
                if (espionageToPerform === this.Types.Purchase.id) {
                    resources.Money.currentQuantity -= poly.govPrice(govIndex);
                }
                let title = game.loc('civics_espionage_actions');
                WindowManager.openModalWindowWithCallback(optionsNode, title, () => {
                    GameLog.logSuccess("spying", `Performing "${game.loc("civics_spy_" + espionageToPerform)}" covert operation against ${getGovName(govIndex)}.`, ['spy']);
                    getVueById('espModal')?.[espionageToPerform]?.(govIndex);
                });
            }
        },

        isEspionageUseful(govIndex, espionageId) {
            let gov = game.global.civic.foreign["gov" + govIndex];

            // Return true when requested task is useful, or when we don't have enough spies prove it's not
            switch (espionageId) {
                case this.Types.Influence.id:
                    return gov.hstl > (gov.spy > 0 ? 0 : 10);
                case this.Types.Sabotage.id:
                    return gov.spy < 1 || gov.mil > (gov.spy > 1 ? 50 : 74);
                case this.Types.Incite.id:
                    return gov.spy < 3 || gov.unrest < (gov.spy > 3 ? 100 : 76);
                case this.Types.Annex.id:
                    return gov.hstl <= 50 && gov.unrest >= 50 && resources.Morale.currentQuantity >= (200 + gov.hstl - gov.unrest);
                case this.Types.Purchase.id:
                    return gov.spy >= 3 && resources.Money.currentQuantity >= poly.govPrice(govIndex);
            }
            return false;
        },
    }

    var WarManager = {
        _garrisonVue: undefined,
        _hellVue: undefined,

        workers: 0,
        wounded: 0,
        raid: 0,
        max: 0,
        m_use: 0,
        crew: 0,
        hellSoldiers: 0,
        hellPatrols: 0,
        hellPatrolSize: 0,
        hellAssigned: 0,
        hellReservedSoldiers: 0,

        updateGarrison() {
            let garrison = game.global.civic.garrison;
            if (garrison) {
                this.workers = garrison.workers;
                this.wounded = garrison.wounded;
                this.raid = garrison.raid;
                this.max = garrison.max;
                this.m_use = garrison.m_use;
                this.crew = garrison.crew;
                this._garrisonVue = getVueById("garrison");
            } else {
                this._garrisonVue = undefined;
            }
        },

        updateHell() {
            let fortress = game.global.portal.fortress;
            if (fortress) {
                this.hellSoldiers = fortress.garrison;
                this.hellPatrols = fortress.patrols;
                this.hellPatrolSize = fortress.patrol_size;
                this.hellAssigned = fortress.assigned;
                this.hellReservedSoldiers = this.getHellReservedSoldiers();
                this._hellVue = getVueById("fort");
            } else {
                this._hellVue = undefined;
            }
        },

        get currentSoldiers() {
            return this.workers - this.crew;
        },

        get maxSoldiers() {
            return this.max - this.crew;
        },

        get deadSoldiers() {
            return this.max - this.workers;
        },

        get currentCityGarrison() {
            return this.currentSoldiers - this.hellSoldiers - (game.global.space.fob?.troops ?? 0);
        },

        get maxCityGarrison() {
            return this.maxSoldiers - this.hellSoldiers;
        },

        get availableGarrison() {
            return game.global.race['rage'] ? this.currentCityGarrison : this.currentCityGarrison - this.wounded;
        },

        get hellGarrison()  {
            return this.hellSoldiers - this.hellPatrolSize * this.hellPatrols - this.hellReservedSoldiers;
        },

        launchCampaign(govIndex) {
            this._garrisonVue.campaign(govIndex);
        },

        release(govIndex) {
            if (game.global.civic.foreign["gov" + govIndex].occ) {
                let occSoldiers = getOccCosts();
                this.workers += occSoldiers;
                this.max += occSoldiers;
            }
            this._garrisonVue.campaign(govIndex);
        },

        isMercenaryUnlocked() {
            return game.global.civic.garrison.mercs;
        },

        // function mercCost from civics.js
        get mercenaryCost() {
            let cost = Math.round((1.24 ** this.workers) * 75) - 50;
            if (cost > 25000){
                cost = 25000;
            }
            if (this.m_use > 0){
                cost *= 1.1 ** this.m_use;
            }
            cost *= traitVal('brute', 0, '-');
            if (game.global.race['inflation']){
                cost *= 1 + (game.global.race.inflation / 500);
            }
            cost *= traitVal('high_pop', 1, '=');
            return Math.round(cost);
        },

        hireMercenary() {
            let cost = this.mercenaryCost;
            if (this.workers >= this.max || resources.Money.currentQuantity < cost){
                return false;
            }

            KeyManager.set(false, false, false);
            this._garrisonVue.hire();

            resources.Money.currentQuantity -= cost;
            this.workers++;
            this.m_use++;

            return true;
        },

        getHellReservedSoldiers(){
            let soldiers = 0;

            // Assign soldiers to assault forge once other requirements are met
            if (settings.autoBuild && buildings.PitAssaultForge.isAutoBuildable()) {
                if (settings.hellAssaultReserve || !Object.entries(buildings.PitAssaultForge.cost).find(([id, amount]) => resources[id].currentQuantity < amount)) {
                    soldiers = Math.round(650 / game.armyRating(1, "hellArmy"));
                }
            }

            // Reserve soldiers operating forge
            if (buildings.PitSoulForge.stateOnCount > 0) {
                // export function soulForgeSoldiers() from portal.js
                soldiers = Math.round(650 / game.armyRating(1, "hellArmy"));
                if (game.global.portal.gun_emplacement) {
                    soldiers -= game.global.portal.gun_emplacement.on * (game.global.tech.hell_gun >= 2 ? 2 : 1);
                    if (soldiers < 0){
                        soldiers = 0;
                    }
                }
            }

            // Guardposts need at least one soldier free so lets just always keep one handy
            if (buildings.RuinsGuardPost.count > 0) {
                soldiers += (buildings.RuinsGuardPost.stateOnCount + 1) * traitVal('high_pop', 0, 1);
            }
            return soldiers;
        },

        setTactic(newTactic){
            let currentTactic = game.global.civic.garrison.tactic;
            for (let i = currentTactic; i < newTactic; i++) {
                this._garrisonVue.next();
            }
            for (let i = currentTactic; i > newTactic; i--) {
                this._garrisonVue.last();
            }
        },

        getCampaignTitle(tactic) {
            return this._garrisonVue.$options.filters.tactics(tactic);
        },

        addBattalion(count) {
            for (let m of KeyManager.click(count)) {
                this._garrisonVue.aNext();
            }

            this.raid = Math.min(this.raid + count, this.currentCityGarrison);
        },

        removeBattalion(count) {
            for (let m of KeyManager.click(count)) {
                this._garrisonVue.aLast();
            }

            this.raid = Math.max(this.raid - count, 0);
        },

        getGovArmy(tactic, govIndex) { // function battleAssessment(gov)
            let enemy = [5, 27.5, 62.5, 125, 300][tactic];
            if (game.global.race['banana']) {
                enemy *= 2;
            }
            if (game.global.city.biome === 'swamp'){
                enemy *= 1.4;
            }
            return enemy * getGovPower(govIndex) / 100;
        },

        getAdvantage(army, tactic, govIndex) {
            return (1 - (this.getGovArmy(tactic, govIndex) / army)) * 100;
        },

        getRatingForAdvantage(adv, tactic, govIndex) {
            return this.getGovArmy(tactic, govIndex) / (1 - (adv/100));
        },

        getSoldiersForAdvantage(advantage, tactic, govIndex) {
            return this.getSoldiersForAttackRating(this.getRatingForAdvantage(advantage, tactic, govIndex));
        },

        // Calculates the required soldiers to reach the given attack rating, assuming everyone is healthy.
        getSoldiersForAttackRating(targetRating) {
            if (!targetRating || targetRating <= 0) {
                return 0;
            }
            // Getting the rating for 10 soldiers and dividing it by number of soldiers, to get more accurate value after rounding
            let singleSoldierAttackRating = game.armyRating(10, "army", 0) / 10;
            let maxSoldiers = Math.ceil(targetRating / singleSoldierAttackRating);
            if (!game.global.race['hivemind']) {
                return maxSoldiers;
            }

            // Ok, we've done no hivemind. Hivemind is trickier because each soldier gives attack rating and a bonus to all other soldiers.
            // I'm sure there is an exact mathematical calculation for this but...
            // Just loop through and remove 1 at a time until we're under the max rating.

            let hiveSize = traitVal('hivemind', 0);
            if (maxSoldiers < hiveSize) {
                maxSoldiers = Math.min(hiveSize, maxSoldiers / (1 - (hiveSize * 0.05)));
            }

            while (maxSoldiers > 1 && game.armyRating(maxSoldiers - 1, "army", 0) > targetRating) {
                maxSoldiers--;
            }

            return maxSoldiers;
        },

        addHellGarrison(count) {
            for (let m of KeyManager.click(count)) {
                this._hellVue.aNext();
            }

            this.hellSoldiers = Math.min(this.hellSoldiers + count, this.workers);
            this.hellAssigned = this.hellSoldiers;
        },

        removeHellGarrison(count) {
            for (let m of KeyManager.click(count)) {
                this._hellVue.aLast();
            }

            let min = this.hellPatrols * this.hellPatrolSize + this.hellReservedSoldiers;
            this.hellSoldiers = Math.max(this.hellSoldiers - count, min);
            this.hellAssigned = this.hellSoldiers;
        },

        addHellPatrol(count) {
            for (let m of KeyManager.click(count)) {
                this._hellVue.patInc();
            }

            if (this.hellPatrols * this.hellPatrolSize < this.hellSoldiers){
                this.hellPatrols += count;
                if (this.hellSoldiers < this.hellPatrols * this.hellPatrolSize){
                    this.hellPatrols = Math.floor(this.hellSoldiers / this.hellPatrolSize);
                }
            }
        },

        removeHellPatrol(count) {
            for (let m of KeyManager.click(count)) {
                this._hellVue.patDec();
            }

            this.hellPatrols = Math.max(this.hellPatrols - count, 0);
        },

        addHellPatrolSize(count) {
            for (let m of KeyManager.click(count)) {
                this._hellVue.patSizeInc();
            }

            if (this.hellPatrolSize < this.hellSoldiers){
                this.hellPatrolSize += count;
                if (this.hellSoldiers < this.hellPatrols * this.hellPatrolSize){
                    this.hellPatrols = Math.floor(this.hellSoldiers / this.hellPatrolSize);
                }
            }
        },

        removeHellPatrolSize(count) {
            for (let m of KeyManager.click(count)) {
                this._hellVue.patSizeDec();
            }

            this.hellPatrolSize = Math.max(this.hellPatrolSize - count, 1);
        }
    }

    var FleetManagerOuter = {
        _fleetVueBinding: "shipPlans",
        _fleetVue: undefined,
        _explorerBlueprint: {class: "explorer", armor: "neutronium", weapon: "railgun", engine: "emdrive", power: "elerium", sensor: "quantum"},

        nextShipName: null,
        nextShipCost: null,
        nextShipAffordable: null,
        nextShipExpandable: null,
        nextShipMsg: null,
        nextShipDesiredCrew: 0,
        nextShipRegion: null,

        WeaponPower: {railgun: 36, laser: 64, p_laser: 54, plasma: 90, phaser: 114, disruptor: 156},
        SensorRange: {visual: 1, radar: 20, lidar: 35, quantum: 60},
        ClassPower: {corvette: 1, frigate: 1.5, destroyer: 2.75, cruiser: 5.5, battlecruiser: 10, dreadnought: 22, explorer: 1.2},
        ClassCrew: {corvette: 2, frigate: 3, destroyer: 4, cruiser: 6, battlecruiser: 8, dreadnought: 10, explorer: 10},

        // spc_dwarf is ignored, never having any syndicate
        Regions: ["spc_moon", "spc_red", "spc_gas", "spc_gas_moon", "spc_belt", "spc_titan", "spc_enceladus", "spc_triton", "spc_kuiper", "spc_eris"],

        ShipConfig: {
            class: ['corvette','frigate','destroyer','cruiser','battlecruiser','dreadnought','explorer'],
            power: ['solar','diesel','fission','fusion','elerium'],
            weapon: ['railgun','laser','p_laser','plasma','phaser','disruptor'],
            armor : ['steel','alloy','neutronium'],
            engine: ['ion','tie','pulse','photon','vacuum','emdrive'],
            sensor: ['visual','radar','lidar','quantum'],
        },

        getWeighting(id) {
            return settings["fleet_outer_pr_" + id];
        },

        getMaxDefense(id) {
            return settings["fleet_outer_def_" + id];
        },

        getMaxScouts(id) {
            return settings["fleet_outer_sc_" + id];
        },

        getShipName(ship) {
            return game.loc(`outer_shipyard_class_${ship.class}`);
        },

        getLocName(loc) {
            let locRef = loc === "tauceti" ? game.loc('tech_era_tauceti') : game.actions.space[loc].info.name;
            return typeof locRef === 'function' ? locRef() : locRef;
        },

        isUnlocked(id) {
            return id === "spc_moon" && game.global.race['orbit_decayed'] ? false
                : game.actions.space[id].info.syndicate?.() ?? false;
        },

        updateNextShip(ship) {
            if (ship) {
                let cost = poly.shipCosts(ship);
                this.nextShipCost = cost;
                this.nextShipAffordable = true;
                this.nextShipExpandable = true;
                this.nextShipMsg = null;
                this.nextShipName = null;
                for (let res in cost) {
                    if (resources[res].maxQuantity < cost[res]) {
                        this.nextShipAffordable = false;
                        if (!resources[res].hasStorage()) {
                            this.nextShipExpandable = false;
                        }
                    }
                }
            } else {
                this.nextShipCost = null;
                this.nextShipAffordable = null;
                this.nextShipExpandable = null;
                this.nextShipMsg = null;
                this.nextShipName = null;
            }
        },

        initFleet() {
            if (!game.global.tech.syndicate || !game.global.space.shipyard?.hasOwnProperty('blueprint')) {
                return false;
            }

            this._fleetVue = getVueById(this._fleetVueBinding);
            if (this._fleetVue === undefined) {
                return false;
            }

            return true;
        },

        getFighterBlueprint() {
            return Object.fromEntries(Object.keys(this.ShipConfig).map(type => ([type, settings["fleet_outer_" + type]])));
        },

        getScoutBlueprint() {
            return Object.fromEntries(Object.keys(this.ShipConfig).map(type => ([type, settings["fleet_scout_" + type]])));
        },

        getMissingResource(ship) {
            let cost = poly.shipCosts(ship);
            for (let res in cost) {
                if (resources[res].currentQuantity < cost[res]) {
                    return res;
                }
            }
            return null;
        },

        avail(ship) {
            let yard = game.global.space.shipyard;
            if (ship.class === "explorer" && (ship.weapon !== "railgun" || ship.sensor !== "quantum")) {
                return false;
            }
            for (let [type, part] of Object.entries(ship)) {
                if (type !== "name" && yard.blueprint[type] !== part && !(ship.class === "explorer" && (part === "weapon" || part === "sensor"))) {
                    if (!this._fleetVue.avail(type, this.ShipConfig[type].indexOf(part), part)) {
                        return false;
                    }
                }
            }
            return true;
        },

        build(ship, region) {
            let yard = game.global.space.shipyard;
            for (let [type, part] of Object.entries(ship)) {
                if (type !== 'name' && (yard.blueprint[type] !== part || ship.class === "explorer" || yard.blueprint.class === "explorer")) {
                    this._fleetVue.setVal(type, part);
                }
            }
            if (this._fleetVue.powerText().includes("danger")) {
                return false;
            }

            let cost = poly.shipCosts(ship);
            for (let res in cost) {
                resources[res].currentQuantity -= cost[res];
            }

            if (yard.sort) {
                $("#shipPlans .b-checkbox").eq(1).click()
                this._fleetVue.build();
                getVueById('shipReg0')?.setLoc(region, yard.ships.length);
                $("#shipPlans .b-checkbox").eq(1).click()
            } else {
                this._fleetVue.build();
                getVueById('shipReg0')?.setLoc(region, yard.ships.length);
            }
            return true;
        },

        getShipAttackPower(ship) {
            return Math.round(this.WeaponPower[ship.weapon] * this.ClassPower[ship.class]);
        },

        shipCount(loc, template) {
            let count = 0;
            for (let ship of game.global.space.shipyard.ships) {
                if (ship.location === loc
                    && (template.class === null || ship.class === template.class)
                    && (template.power === null || ship.power === template.power)
                    && (template.weapon === null || ship.weapon === template.weapon)
                    && (template.armor === null || ship.armor === template.armor)
                    && (template.engine === null || ship.engine === template.engine)
                    && (template.sensor === null || ship.sensor === template.sensor)) {
                    count++;
                }
            }
            return count;
        },

        // export function syndicate(region,extra) from truepath.js with added "all" argument
        syndicate(region, extra, all) {
            if (!game.global.tech['syndicate'] || !game.global.race['truepath'] || !game.global.space.syndicate?.hasOwnProperty(region)){
                return extra ? {p: 1, r: 0, s: 0} : 1;
            }
            let rivalRel = game.global.civic.foreign.gov3.hstl;
            let rival = rivalRel < 10 ? (250 - (25 * rivalRel)) :
                        rivalRel > 60 ? (-13 * (rivalRel - 60)) : 0;

            let divisor = 1000;
            switch (region){
                case 'spc_home':
                case 'spc_moon':
                case 'spc_red':
                case 'spc_hell':
                    divisor = 1250 + rival;
                    break;
                case 'spc_gas':
                case 'spc_gas_moon':
                case 'spc_belt':
                    divisor = 1020 + rival;
                    break;
                case 'spc_titan':
                case 'spc_enceladus':
                    divisor = !haveTech('triton') ? 600 :
                      game.actions.space[region].info.syndicate_cap();
                    break;
                case 'spc_triton':
                case 'spc_kuiper':
                case 'spc_eris':
                    divisor = game.actions.space[region].info.syndicate_cap();
                    break;
            }

            let piracy = game.global.space.syndicate[region];
            let patrol = 0;
            let sensor = 0;
            if (game.global.space.shipyard?.hasOwnProperty('ships')){
                for (let ship of game.global.space.shipyard.ships) {
                    if (ship.location === region && ((ship.transit === 0 && ship.fueled) || all)){
                        let rating = this.getShipAttackPower(ship);
                        patrol += ship.damage > 0 ? Math.round(rating * (100 - ship.damage) / 100) : rating;
                        sensor += this.SensorRange[ship.sensor];
                    }
                }

                if (region === 'spc_enceladus'){
                    patrol += buildings.EnceladusBase.stateOnCount * 50;
                } else if (region === 'spc_titan'){
                    patrol += buildings.TitanSAM.stateOnCount * 25;
                } else if (region === 'spc_triton' && buildings.TritonFOB.stateOnCount > 0){
                    patrol += 500;
                    sensor += 10;
                }

                if (sensor > 100){
                    sensor = Math.round((sensor - 100) / ((sensor - 100) + 200) * 100) + 100;
                }

                patrol = Math.round(patrol * ((sensor + 25) / 125));
                piracy = piracy - patrol > 0 ? piracy - patrol : 0;
            }
            if (extra) {
                return {
                    p: 1 - +(piracy / divisor).toFixed(4),
                    r: piracy,
                    s: sensor
                };
            } else {
                return 1 - +(piracy / divisor).toFixed(4);
            }
        }
    }

    var FleetManager = {
        _fleetVueBinding: "fleet",
        _fleetVue: undefined,

        initFleet() {
            if (!game.global.tech.piracy) {
                return false;
            }

            this._fleetVue = getVueById(this._fleetVueBinding);
            if (this._fleetVue === undefined) {
                return false;
            }

            return true;
        },

        addShip(region, ship, count) {
            for (let m of KeyManager.click(count)) {
                this._fleetVue.add(region, ship);
            }
        },

        subShip(region, ship, count) {
            for (let m of KeyManager.click(count)) {
                this._fleetVue.sub(region, ship);
            }
        }
    }

    var MechManager = {
        _assemblyVueBinding: "mechAssembly",
        _assemblyVue: undefined,
        _listVueBinding: "mechList",
        _listVue: undefined,

        activeMechs: [],
        inactiveMechs: [],
        mechsPower: 0,
        mechsPotential: 0,
        isActive: false,
        saveSupply: false,

        stateHash: 0,
        bestSize: [],
        bestGems: [],
        bestSupply: [],
        bestMech: {},
        bestBody: {},
        bestWeapon: [],

        Size: ['small','medium','large','titan','collector'],
        Chassis: ['wheel','tread','biped','quad','spider','hover'],
        Weapon: ['laser','kinetic','shotgun','missile','flame','plasma','sonic','tesla'],
        Equip: ['special','shields','sonar','grapple','infrared','flare','radiator','coolant','ablative','stabilizer','seals'],

        SizeSlots: {small: 0, medium: 1, large: 2, titan: 4, collector: 2},
        SizeWeapons: {small: 1, medium: 1, large: 2, titan: 4, collector: 0},
        SmallChassisMod: {
            wheel:  { sand: 0.9,  swamp: 0.35, forest: 1,    jungle: 0.92, rocky: 0.65, gravel: 1,    muddy: 0.85, grass: 1.3,  brush: 0.9,  concrete: 1.1},
            tread:  { sand: 1.15, swamp: 0.55, forest: 1,    jungle: 0.95, rocky: 0.65, gravel: 1.3,  muddy: 0.88, grass: 1,    brush: 1,    concrete: 1},
            biped:  { sand: 0.78, swamp: 0.68, forest: 1,    jungle: 0.82, rocky: 0.48, gravel: 1,    muddy: 0.85, grass: 1.25, brush: 0.92, concrete: 1},
            quad:   { sand: 0.86, swamp: 0.58, forest: 1.25, jungle: 1,    rocky: 0.95, gravel: 0.9,  muddy: 0.68, grass: 1,    brush: 0.95, concrete: 1},
            spider: { sand: 0.75, swamp: 0.9,  forest: 0.82, jungle: 0.77, rocky: 1.25, gravel: 0.86, muddy: 0.92, grass: 1,    brush: 1,    concrete: 1},
            hover:  { sand: 1,    swamp: 1.35, forest: 0.65, jungle: 0.55, rocky: 0.82, gravel: 1,    muddy: 1.15, grass: 1,    brush: 0.78, concrete: 1}
        },
        LargeChassisMod: {
            wheel:  { sand: 0.85, swamp: 0.18, forest: 1,    jungle: 0.85, rocky: 0.5,  gravel: 0.95, muddy: 0.58, grass: 1.2,  brush: 0.8,  concrete: 1},
            tread:  { sand: 1.1,  swamp: 0.4,  forest: 0.95, jungle: 0.9,  rocky: 0.5,  gravel: 1.2,  muddy: 0.72, grass: 1,    brush: 1,    concrete: 1},
            biped:  { sand: 0.65, swamp: 0.5,  forest: 0.95, jungle: 0.7,  rocky: 0.4,  gravel: 1,    muddy: 0.7,  grass: 1.2,  brush: 0.85, concrete: 1},
            quad:   { sand: 0.75, swamp: 0.42, forest: 1.2,  jungle: 1,    rocky: 0.9,  gravel: 0.8,  muddy: 0.5,  grass: 0.95, brush: 0.9,  concrete: 1},
            spider: { sand: 0.65, swamp: 0.78, forest: 0.75, jungle: 0.65, rocky: 1.2,  gravel: 0.75, muddy: 0.82, grass: 1,    brush: 0.95, concrete: 1},
            hover:  { sand: 1,    swamp: 1.2,  forest: 0.48, jungle: 0.35, rocky: 0.68, gravel: 1,    muddy: 1.08, grass: 1,    brush: 0.7,  concrete: 1}
        },
        StatusMod: {
            freeze: (mech) => !mech.equip.includes('radiator') ? 0.25 : 1,
            hot: (mech) => !mech.equip.includes('coolant') ? 0.25 : 1,
            corrosive: (mech) => !mech.equip.includes('ablative') ? mech.equip.includes('shields') ? 0.75 : 0.25 : 1,
            humid: (mech) => !mech.equip.includes('seals') ? 0.75 : 1,
            windy: (mech) => mech.chassis === 'hover' ? 0.5 : 1,
            hilly: (mech) => mech.chassis !== 'spider' ? 0.75 : 1,
            mountain: (mech) => mech.chassis !== 'spider' && !mech.equip.includes('grapple') ? mech.equip.includes('flare') ? 0.75 : 0.5 : 1,
            radioactive: (mech) => !mech.equip.includes('shields') ? 0.5 : 1,
            quake: (mech) => !mech.equip.includes('stabilizer') ? 0.25 : 1,
            dust: (mech) => !mech.equip.includes('seals') ? 0.5 : 1,
            river: (mech) => mech.chassis !== 'hover' ? 0.65 : 1,
            tar: (mech) => mech.chassis !== 'quad' ? mech.chassis === 'tread' || mech.chassis === 'wheel' ? 0.5 : 0.75 : 1,
            steam: (mech) => !mech.equip.includes('shields') ? 0.75 : 1,
            flooded: (mech) => mech.chassis !== 'hover' ? 0.35 : 1,
            fog: (mech) => !mech.equip.includes('sonar') ? 0.2 : 1,
            rain: (mech) => !mech.equip.includes('seals') ? 0.75 : 1,
            hail: (mech) => !mech.equip.includes('ablative') && !mech.equip.includes('shields') ? 0.75 : 1,
            chasm: (mech) => !mech.equip.includes('grapple') ? 0.1 : 1,
            dark: (mech) => !mech.equip.includes('infrared') ? mech.equip.includes('flare') ? 0.25 : 0.1 : 1,
            gravity: (mech) => mech.size === 'titan' ? 0.25 : mech.size === 'large' ? 0.45 : mech.size === 'medium' ? 0.8 : 1,
        },

        get collectorValue() {
            // Collectors power mod. Higher number - more often they'll be scrapped. Default value derieved from scout: 20000 = collectorBaseIncome / (scoutPower / scoutSize), to equalize relative values of collectors and combat mechs with same efficiency.
            return 20000 / Math.max(settings.mechCollectorValue, 0.000001);
        },

        mechObserver: new MutationObserver(() => {
            updateDebugData(); // Observer can be can be called at any time, make sure we have actual data
            createMechInfo();
        }),

        updateSpire() {
            let oldHash = this.stateHash;
            this.stateHash = 0
              + game.global.portal.spire.count
              + game.global.blood.prepared
              + game.global.blood.wrath
              + game.global.portal.mechbay.scouts * 1e7
              + (settings.mechSpecial ? 1e14 : 0)
              + (settings.mechInfernalCollector ? 1e15 : 0)
              + (settings.mechCollectorValue);

              return this.stateHash !== oldHash;
        },

        initLab() {
            if (buildings.SpireMechBay.count < 1) {
                return false;
            }
            this._assemblyVue = getVueById(this._assemblyVueBinding);
            if (this._assemblyVue === undefined) {
                return false;
            }
            this._listVue = getVueById(this._listVueBinding);
            if (this._listVue === undefined) {
                return false;
            }

            this.activeMechs = [];
            this.inactiveMechs = [];
            this.mechsPower = 0;

            let mechBay = game.global.portal.mechbay;
            for (let i = 0; i < mechBay.mechs.length; i++) {
                let mech = {id: i, ...mechBay.mechs[i], ...this.getMechStats(mechBay.mechs[i])};
                if (i < mechBay.active) {
                    this.activeMechs.push(mech);
                    if (mech.size !== 'collector') {
                        this.mechsPower += mech.power;
                    }
                } else {
                    this.inactiveMechs.push(mech);
                }
            }

            if (this.updateSpire()) {
                this.isActive = true;

                this.updateBestWeapon();
                this.Size.forEach(size => {
                    this.updateBestBody(size);
                    this.bestMech[size] = this.getRandomMech(size);
                });
                let sortBy = (prop) => Object.values(this.bestMech)
                  .filter(m => m.size !== 'collector')
                  .sort((a, b) => b[prop] - a[prop])
                  .map(m => m.size);

                this.bestSize = sortBy('efficiency');
                this.bestGems = sortBy('gems_eff');
                this.bestSupply = sortBy('supply_eff');

                // Redraw added label of Mech Lab after change of floor
                createMechInfo();
            }

            let bestMech = this.bestMech[this.bestSize[0]];
            this.mechsPotential = this.mechsPower / (buildings.SpireMechBay.count * 25 / this.getMechSpace(bestMech) * bestMech.power) || 0;

            return true;
        },

        getBodyMod(mech) {
            let floor = game.global.portal.spire;
            let terrainFactor = mech.size === 'small' || mech.size === 'medium' ?
                this.SmallChassisMod[mech.chassis][floor.type]:
                this.LargeChassisMod[mech.chassis][floor.type];

            let rating = poly.terrainRating(mech, terrainFactor, Object.keys(floor.status));
            for (let effect in floor.status) {
                rating *= this.StatusMod[effect](mech);
            }
            return rating;
        },

        getWeaponMod(mech) {
            let weapons = poly.monsters[game.global.portal.spire.boss].weapon;
            let rating = 0;
            for (let i = 0; i < mech.hardpoint.length; i++){
                rating += poly.weaponPower(mech, weapons[mech.hardpoint[i]]);
            }
            return rating;
        },

        getSizeMod(mech, concrete) {
            let isConcrete = concrete ?? game.global.portal.spire.type === 'concrete';
            switch (mech.size){
                case 'small':
                    return 0.0025 * (isConcrete ? 0.92 : 1);
                case 'medium':
                    return 0.0075 * (isConcrete ? 0.95 : 1);
                case 'large':
                    return 0.01;
                case 'titan':
                    return 0.012 * (isConcrete ? 1.25 : 1);
                case 'collector': // For collectors we're calculating supply rate
                    return 25 / this.collectorValue;
            }
            return 0;
        },

        getProgressMod() {
            let mod = 1;
            if (game.global.stats.achieve.gladiator?.l > 0) {
                mod *= 1 + game.global.stats.achieve.gladiator.l * 0.2;
            }
            if (game.global.blood['wrath']){
                mod *= 1 + (game.global.blood.wrath / 20);
            }
            mod /= game.global.portal.spire.count;

            return mod;
        },

        getPreferredSize() {
            let mechBay = game.global.portal.mechbay;
            if (settings.mechFillBay && mechBay.max % 1 === 0 && (game.global.blood.prepared >= 2 ? mechBay.bay % 2 !== mechBay.max % 2 : mechBay.max - mechBay.bay === 1)) {
                return ['collector', true]; // One collector to fill odd bay
            }

            if (resources.Supply.storageRatio < 0.9 && resources.Supply.rateOfChange < settings.mechMinSupply) {
                let collectorsCount = this.activeMechs.filter(mech => mech.size === 'collector').length;
                if (collectorsCount / mechBay.max < settings.mechMaxCollectors) {
                    return ['collector', true]; // Bootstrap income
                }
            }

            if (mechBay.scouts * 2 / mechBay.max < settings.mechScouts) {
                return ['small', true]; // Build scouts up to configured ratio
            }

            let floorSize = game.global.portal.spire.status.gravity ? settings.mechSizeGravity : settings.mechSize;
            if (this.Size.includes(floorSize) && (!settings.mechFillBay || poly.mechCost(floorSize).c <= resources.Supply.maxQuantity)) {
                return [floorSize, false]; // This floor have configured size
            }
            let mechPriority = floorSize === "gems" ? this.bestGems :
                               floorSize === "supply" ? this.bestSupply :
                               this.bestSize;

            for (let i = 0; i < mechPriority.length; i++) {
                let mechSize = mechPriority[i];
                let {s, c} = poly.mechCost(mechSize);
                if (resources.Soul_Gem.spareQuantity >= s && resources.Supply.maxQuantity >= c) {
                    return [mechSize, false]; // Affordable mech for auto size
                }
            }

            return ['titan', false]; // Just a stub, if auto size couldn't pick anything
        },

        getMechStats(mech) {
            let rating = this.getBodyMod(mech);
            if (mech.size !== 'collector') { // Collectors doesn't have weapons
                rating *= this.getWeaponMod(mech);
            }
            let power = rating * this.getSizeMod(mech) * (mech.infernal ? 1.25 : 1);
            let [gem, supply, space] = this.getMechCost(mech);
            let [gemRef, supplyRef] = this.getMechRefund(mech);
            return {power: power, efficiency: power / space, gems_eff: power / (gem - gemRef), supply_eff: power / (supply - supplyRef)};
        },

        getTimeToClear() {
            return this.mechsPower > 0 ? (100 - game.global.portal.spire.progress) / (this.mechsPower * this.getProgressMod()) : Number.MAX_SAFE_INTEGER;
        },

        updateBestBody(size) {
            let currentBestBodyMod = 0;
            let currentBestBodyList = [];

            let equipmentSlots = this.SizeSlots[size] + (game.global.blood.prepared ? 1 : 0) - (settings.mechSpecial === "always" ? 1 : 0);
            let equipOptions = settings.mechSpecial === "always" || settings.mechSpecial === "never" ? this.Equip.slice(1) : this.Equip;
            let infernal = settings.mechInfernalCollector && size === 'collector' && game.global.blood.prepared >= 3;

            k_combinations(equipOptions, equipmentSlots).forEach((equip) => {
                this.Chassis.forEach(chassis => {
                    let mech = {size: size, chassis: chassis, equip: equip, infernal: infernal};
                    let mechMod = this.getBodyMod(mech);
                    if (mechMod > currentBestBodyMod) {
                        currentBestBodyMod = mechMod;
                        currentBestBodyList = [mech];
                    } else if (mechMod === currentBestBodyMod) {
                        currentBestBodyList.push(mech);
                    }
                });
            });

            if (settings.mechSpecial === "always" && equipmentSlots >= 0) {
                currentBestBodyList.forEach(mech => mech.equip.unshift('special'));
            }
            if (settings.mechSpecial === "prefered") {
                let specialEquip = currentBestBodyList.filter(mech => mech.equip.includes("special"));
                if (specialEquip.length > 0) {
                    currentBestBodyList = specialEquip;
                }
            }
            /* TODO: Not really sure how to utilize it for good: it does find good and bad mech compositions, but using only good ones can backfire on unlucky consequent floors, and there won't big enough amount of mech to use weighted random
            currentBestBodyList.forEach(mech => {
                mech.weigthing = Object.values(this.StatusMod)
                  .reduce((sum, mod) => sum + mod(mech), 0);
            });
            */
            this.bestBody[size] = currentBestBodyList;
        },

        updateBestWeapon() {
            let bestMod = 0;
            let list = poly.monsters[game.global.portal.spire.boss].weapon;
            for (let weapon in list) {
                let mod = list[weapon];
                if (mod > bestMod) {
                    bestMod = mod;
                    this.bestWeapon = [weapon];
                } else if (mod === bestMod) {
                    this.bestWeapon.push(weapon);
                }
            }
        },

        getRandomMech(size) {
            let randomBody = this.bestBody[size][Math.floor(Math.random() * this.bestBody[size].length)];
            let randomWeapon = this.bestWeapon[Math.floor(Math.random() * this.bestWeapon.length)];
            let weaponsAmount = this.SizeWeapons[size];
            let mech = {hardpoint: new Array(weaponsAmount).fill(randomWeapon), ...randomBody};
            return {...mech, ...this.getMechStats(mech)};
        },

        getMechSpace(mech, prep) {
            switch (mech.size){
                case 'small':
                    return 2;
                case 'medium':
                    return (prep ?? game.global.blood.prepared) >= 2 ? 4 : 5;
                case 'large':
                    return (prep ?? game.global.blood.prepared) >= 2 ? 8 : 10;
                case 'titan':
                    return (prep ?? game.global.blood.prepared) >= 2 ? 20 : 25;
                case 'collector':
                    return 1;
            }
            return Number.MAX_SAFE_INTEGER;
        },

        getMechCost(mech, prep) {
            let {s, c} = poly.mechCost(mech.size, mech.infernal, prep);
            return [s, c, this.getMechSpace(mech, prep)];
        },

        getMechRefund(mech, prep) {
            let {s, c} = poly.mechCost(mech.size, mech.infernal, prep);
            return [Math.floor(s / 2), Math.floor(c / 3)];
        },

        mechDesc(mech) {
            // (${mech.hardpoint.map(id => game.loc("portal_mech_weapon_" + id)).join(", ")}) [${mech.equip.map(id => game.loc("portal_mech_equip_" + id)).join(", ")}]
            let rating = mech.power / this.bestMech[mech.size].power;
            return `${game.loc("portal_mech_size_" + mech.size)} ${game.loc("portal_mech_chassis_" + mech.chassis)} (${Math.round(rating * 100)}%)`;
        },

        buildMech(mech) {
            this._assemblyVue.b.infernal = mech.infernal;
            this._assemblyVue.setSize(mech.size);
            this._assemblyVue.setType(mech.chassis);
            for (let i = 0; i < mech.hardpoint.length; i++) {
                this._assemblyVue.setWep(mech.hardpoint[i], i);
            }
            for (let i = 0; i < mech.equip.length; i++) {
                this._assemblyVue.setEquip(mech.equip[i], i);
            }
            this._assemblyVue.build();
            GameLog.logSuccess("mech_build", `${this.mechDesc(mech)} mech has been assembled.`, ['hell']);
        },

        scrapMech(mech) {
            this._listVue.scrap(mech.id);
        },

        dragMech(oldId, newId) {
            let sortObj = {oldDraggableIndex: oldId, newDraggableIndex: newId, from: {querySelectorAll: () => [], insertBefore: () => false}};
            if (typeof unsafeWindow !== 'undefined') { // Yet another FF fix
                win.Sortable.get(this._listVue.$el).options.onEnd(cloneInto(sortObj, unsafeWindow, {cloneFunctions: true}));
            } else {
                Sortable.get(this._listVue.$el).options.onEnd(sortObj);
            }
        }
    }

    var JobManager = {
        priorityList: [],
        craftingJobs: [],

        sortByPriority() {
            this.priorityList.sort((a, b) => a.priority - b.priority);
        },

        managedPriorityList() {
            let ret = [];
            if (settings.autoJobs) {
                ret = this.priorityList.filter(job => job.isManaged());
            }
            if (settings.autoCraftsmen) {
                ret = ret.concat(this.craftingJobs.filter(job => job.isManaged()));
            }
            return ret;
        },

        servantsMax() {
            if (!game.global.race.servants) {
                return 0;
            }

            let max = game.global.race.servants.max;
            for (let job of this.priorityList) {
                if (job.is.serve && !job.isManaged()) {
                    max -= job.servants;
                }
            }
            return max;
        },

        skilledServantsMax() {
            if (!game.global.race.servants) {
                return 0;
            }

            let max = game.global.race.servants.smax;
            for (let job of this.craftingJobs) {
                if (!job.isManaged()) {
                    max -= job.servants;
                }
            }
            return max;
        },

        craftingMax() {
            if (!game.global.city.foundry) {
                return 0;
            }

            let max = game.global.civic.craftsman.max;
            for (let job of this.craftingJobs) {
                if (!job.isManaged()) {
                    max -= job.count;
                }
            }
            // Thermite is ignored by script, let's pretend it's not exists
            max -= game.global.city.foundry.Thermite ?? 0;
            return max;
        }
    }

    var BuildingManager = {
        priorityList: [],
        statePriorityList: [],

        updateBuildings() {
            for (let building of Object.values(buildings)){
                building.updateResourceRequirements();
                building.extraDescription = "";
            }
        },

        updateWeighting() {
             // Check generic conditions, and multiplier - x1 have no effect, so skip them too.
            let activeRules = weightingRules.filter(rule => rule[wrGlobalCondition]() && rule[wrMultiplier]() !== 1);

            // Iterate over buildings
            for (let building of this.priorityList){
                building.weighting = building._weighting;

                // Apply weighting rules
                for (let j = 0; j < activeRules.length; j++) {
                    let result = activeRules[j][wrIndividualCondition](building);
                    // Rule passed
                    if (result) {
                        let note = activeRules[j][wrDescription](result, building);
                        if (note !== "") {
                            building.extraDescription += note + "<br>";
                        }
                        building.weighting *= activeRules[j][wrMultiplier](result);


                        // Last rule disabled building, no need to check the rest
                        if (building.weighting <= 0) {
                            break;
                        }
                    }
                }
                if (building.weighting > 0) {
                    building.weighting = Math.max(Number.MIN_VALUE, building.weighting - 1e-7 * building.count);
                    building.extraDescription = "AutoBuild weighting: " + getNiceNumber(building.weighting) + "<br>" + building.extraDescription;
                }
            }
        },

        sortByPriority() {
            this.priorityList.sort((a, b) => a.priority - b.priority);
            this.statePriorityList.sort((a, b) => a.priority - b.priority);
        },

        managedPriorityList() {
            return this.priorityList.filter(building => building.weighting > 0);
        },

        managedStatePriorityList() {
            return this.statePriorityList.filter(building => (building.hasState() && building.autoStateEnabled && building.count > 0));
        }
    }

    var ProjectManager = {
        priorityList: [],

        updateProjects() {
            for (let project of this.priorityList){
                project.updateResourceRequirements();
                project.extraDescription = "";
            }
        },

        updateWeighting() {
            // Iterate over projects
            for (let project of this.priorityList){
                project.weighting = project._weighting * project.currentStep;

                if (!project.isUnlocked()) {
                    project.weighting = 0;
                    project.extraDescription = "Locked<br>";
                }
                if (!project.autoBuildEnabled || !settings.autoARPA) {
                    project.weighting = 0;
                    project.extraDescription = "AutoBuild disabled<br>";
                }
                if (project.count >= project.autoMax && (project !== projects.ManaSyphon || !isPrestigeAllowed("vacuum"))) {
                    project.weighting = 0;
                    project.extraDescription = "Maximum amount reached<br>";
                }
                if (settings.prestigeMADIgnoreArpa && isEarlyGame()) {
                    project.weighting = 0;
                    project.extraDescription = "Projects ignored Pre-MAD<br>";
                }
                if (state.queuedTargets.includes(project)) {
                    project.weighting = 0;
                    project.extraDescription = "Queued project, processing...<br>";
                }
                if (state.triggerTargets.includes(project)) {
                    project.weighting = 0;
                    project.extraDescription = "Active trigger, processing...<br>";
                }
                if (!project.isAffordable(true)) {
                    project.weighting = 0;
                    project.extraDescription = "Not enough storage<br>";
                }
                if (project === projects.ManaSyphon && settings.prestigeBioseedConstruct && (settings.prestigeType === "ascension" || settings.prestigeType === "demonic") && game.global.race['witch_hunter']) {
                    project.weighting = 0;
                    project.extraDescription = "Not needed for current prestige<br>";
                }

                if (settings.arpaScaleWeighting) {
                    project.weighting /= 1 - (0.01 * project.progress);
                }
                if (project.weighting > 0) {
                    project.extraDescription = `AutoARPA weighting: ${getNiceNumber(project.weighting)} (${project.currentStep}%)<br>${project.extraDescription}`;
                }
            }
        },

        sortByPriority() {
            this.priorityList.sort((a, b) => a.priority - b.priority);
        },

        managedPriorityList() {
            return this.priorityList.filter(project => project.weighting > 0);
        }
    }

    var TriggerManager = {
        priorityList: [],
        targetTriggers: [],

        resetTargetTriggers() {
            this.targetTriggers = [];
            for (let trigger of this.priorityList) {
                trigger.updateComplete();
                if (!trigger.complete && trigger.areRequirementsMet() && trigger.isActionPossible() && !this.actionConflicts(trigger)) {
                    this.targetTriggers.push(trigger);
                }
            }
        },

        getTrigger(seq) {
            return this.priorityList.find(trigger => trigger.seq === seq);
        },

        sortByPriority() {
            this.priorityList.sort((a, b) => a.priority - b.priority);
        },

        AddTrigger(requirementType, requirementId, requirementCount, actionType, actionId, actionCount) {
            let trigger = new Trigger(this.priorityList.length, this.priorityList.length, requirementType, requirementId, requirementCount, actionType, actionId, actionCount);
            this.priorityList.push(trigger);
            return trigger;
        },

        AddTriggerFromSetting(raw) {
            let existingSequence = this.priorityList.some(trigger => trigger.seq === raw.seq);
            if (!existingSequence) {
                let trigger = new Trigger(raw.seq, raw.priority, raw.requirementType, raw.requirementId, raw.requirementCount, raw.actionType, raw.actionId, raw.actionCount);
                this.priorityList.push(trigger);
            }
        },

        RemoveTrigger(seq) {
            let indexToRemove = this.priorityList.findIndex(trigger => trigger.seq === seq);

            if (indexToRemove === -1) {
                return;
            }

            this.priorityList.splice(indexToRemove, 1);

            for (let i = 0; i < this.priorityList.length; i++) {
                let trigger = this.priorityList[i];
                trigger.seq = i;
                trigger.priority = i;
            }
        },

        // This function only checks if two triggers use the same resource, it does not check storage
        actionConflicts(trigger) {
            for (let targetTrigger of this.targetTriggers) {
                if (Object.keys(targetTrigger.cost()).some(cost => Object.keys(trigger.cost()).includes(cost))) {
                    return true;
                }
            }

            return false;
        },
    }
    
    /** @enum {number} */
    const AdvTriggerState = {
        Default: 0, // Default state
        FolderDisabled: 1, // Folder is disabled - trigger ignored/not evaluated
        TriggerDisabled: 2, // Trigger is disabled by user via toggle
        ActionImpossible: 3, // TODO: Optimization if we know an action is never possible during the current run (path-exclusive buildings)
        WaitBaseCondition: 4, // Waiting on the basic condition, override not yet evaluated
        WaitActionAvailable: 5, // Action not yet unlocked
        WaitOverrides: 6, // Evaluating override until a decisive answer comes
        Active: 7, // Currently active trigger, will be built if possible
        Complete: 8, // Trigger completed
        Irrelevant: 9, // Override marked trigger irrelevant for this run, don't check anymore
        UserRequestedSkip: 10, // User manually clicked X to skip trigger
    };
    const AdvTriggerStateNames = Object.fromEntries(Object.entries(AdvTriggerState).map(
        ([key, val]) => [val, key.replace(/([^A-Z])([A-Z])/g, "$1 $2")]
    ));
    // States we can't move out of ourselves. These also activate chain triggers.
    const AdvTriggerNonUpdateStates = [
        AdvTriggerState.Complete,
        AdvTriggerState.FolderDisabled,
        AdvTriggerState.TriggerDisabled,
        AdvTriggerState.ActionImpossible, 
        AdvTriggerState.Irrelevant,
        AdvTriggerState.UserRequestedSkip,
    ];

    const AdvTriggerRequirementTypeNames = {
        "building": "Building",
        "research": "Researched",
        "buildingAvailable": "Building Available",
        "researchAvailable": "Research Available",
        "arpa": "ARPA",
        "always": "Override Only",
    };
    const AdvTriggerActionTypeNames = {
        "building": "Build",
        "research": "Research",
        "arpa": "ARPA",
        "buildRepeatable": "Build (Repeatable)",
        "arpaRepeatable": "ARPA (Repeatable)",
    };

    class AdvTrigger {
        /** @type {string} */
        id;

        /** @type {AdvTriggerFolder} */
        parent;

        /** @type {AdvTriggerState} */
        state = AdvTriggerState.Default;

        needsUpdate = true;
        rendered = false;

        /**
         * @typedef {Object} AdvTriggerCfg Configuration object for a single trigger
         * @property {"building"|"research"|"buildingAvailable"|"researchAvailable"|"arpa"|"always"} requirementType
         * @property {string} requirementId
         * @property {number} requirementCount
         * @property {"research"|"building"|"arpa"|"buildRepeatable"|"arpaRepeatable"} actionType
         * @property {string} actionId
         * @property {number} actionCount
         * @property {number} priority Default priority (do not directly read)
         * @property {Array} stateOverride Overrides for state
         * @property {Array} priorityOverride Overrides for priority level
         * @property {boolean} enabled User-configurable toggle
         */
        /** @type {AdvTriggerCfg} cfg */
        cfg = {};

        /** @type {HTMLTableRowElement} */
        tr = document.createElement("tr");

        /** @type {Action|Technology|Project|null} */
        requirementTarget;

        /** @type {Action|Technology|Project|null} */
        actionTarget;

        /**
         * @param {string} id
         * @param {AdvTriggerFolder} parent
         * @param {AdvTriggerCfg} cfg
         */
        constructor(id, parent, cfg) {
            this.id = id;
            this.parent = parent;
            this.cfg = Object.assign(this.defaultConfig(), cfg);
            this.tr.dataset.triggerId = id;
            this.updateTargets();
        }

        /** @returns {AdvTriggerCfg} */
        static defaultConfig() {
            return {
                requirementType: "researchAvailable",
                requirementId: "tech-club",
                requirementCount: 1,
                actionType: "research",
                actionId: "tech-club",
                actionCount: 1,
                priority: 100,
                stateOverride: [],
                priorityOverride: [],
                enabled: true,
            };
        }

        static targetTypeIsRepeatable() {
            return ["buildRepeatable", "arpaRepeatable"].includes(this.cfg.actionType);
        }

        static targetTypeHasCount(targetType) {
            return ["building", "arpa"].includes(targetType);
        }

        /** @returns {Building|Technology|Project|null} */
        static findTarget(targetType, targetId) {
            targetType = targetType.replace(/Repeatable|Available/, "");
            switch(targetType) {
                case 'building':
                    return buildingIds[targetId] || null;
                case 'research':
                    return techIds[targetId] || null;
                case 'arpa':
                    return arpaIds[targetId] || null;
            }
            return null;
        }

        // For error messages, nothing too fancy
        get name() {
            return `${this.cfg.requirementType} ${this?.requirementTarget?.name??'unknown'} => ${this.cfg.actionType} ${this?.actionTarget?.name??'unknown'}`;
        }

        updateTargets() {
            this.requirementTarget = AdvTrigger.findTarget(this.cfg.requirementType, this.cfg.requirementId);
            this.actionTarget = AdvTrigger.findTarget(this.cfg.actionType, this.cfg.actionId);
        }

        isComplete() {
            return this.state === AdvTriggerState.Complete || this.state === AdvTriggerState.Irrelevant;
        }

        requirementIsComplete() {
            // This checks the base requirement only.
            if (this.cfg.requirementType === "always") return true;

            if (this.cfg.requirementType === "chain") {
                return this.parent.chainTriggerFor(this)?.isComplete() ?? true;
            }

            let req = this.mapTarget(this.cfg.requirementType, this.cfg.requirementId);
            return req && req.count >= (AdvTrigger.targetTypeHasCount(this.cfg.requirementType) ? this.cfg.requirementCount : 1);
        }

        actionIsComplete() {
            // Repeatable actions are never considered complete.
            if (this.isRepeatable()) return false;

            let action = this.mapTarget(this.cfg.actionType, this.cfg.actionId);
            return action && action.count >= (AdvTrigger.targetTypeHasCount(this.cfg.actionType) ? this.cfg.actionCount : 1);
        }

        get priority() {
            if (Array.isArray(this.cfg.priorityOverride) && this.cfg.priorityOverride.length) {
                let num = evaluateOverride(this.cfg.priorityOverride, `${this.name} (priority)`, "number");
                if (typeof num === "number") return num;
            }
            return this.cfg.priority;
        }

        updateState() {
            // Short-circuit for states we can't move out of ourselves
            if (!this.needsUpdate) return;
            if (AdvTriggerNonUpdateStates.includes(this.state)) {
                this.needsUpdate = false;
                return;
            }

            // Main state machine
            let transitioned = false;
            let everTransitioned = false;
            let transition = (st) => {this.state = st; transitioned = true; everTransitioned = true;};
            do {
                transitioned = false;
                switch (this.state) {
                    case AdvTriggerState.Default:
                        // Default exists to try to auto-recover state.
                        if (!this.parent.enabled) {
                            transition(AdvTriggerState.FolderDisabled);
                            break;
                        }
                        if (!this.cfg.enabled) {
                            transition(AdvTriggerState.TriggerDisabled);
                            break;
                        }

                        if (this.requirementIsComplete()) {
                            if (this.actionIsComplete()) {
                                transition(AdvTriggerState.Complete);
                            }
                            else {
                                // TODO: Action impossible check goes here
                                transition(AdvTriggerState.WaitActionAvailable);
                            }
                        }
                        else {
                            transition(AdvTriggerState.WaitBaseCondition);
                        }
                        break;

                    case AdvTriggerState.WaitBaseCondition:
                        if (this.baseConditionMet()) {
                            transition(AdvTriggerState.WaitActionAvailable);
                        }
                        break;

                    case AdvTriggerState.WaitActionAvailable:
                        if (this.actionAvailable()) {
                            transition(AdvTriggerState.WaitOverrides);
                        }
                        break;

                    case AdvTriggerState.WaitOverrides:
                        // For the purpose of chain triggers, we need to move to complete once the requirement
                        // *and* the action are met, even if the user's conditions never let us trigger.
                        // This should keep behavior consistent when buildings are built "by accident"
                        // and on page reloads/trigger refreshes.
                        if (this.actionIsComplete()) {
                            transition(AdvTriggerState.Complete);
                            break;
                        }

                        // If the user didn't specify any conditions, the default is "active".
                        // If the user specifies at least one condition, the default is "wait".
                        // This may seem a little unintuivie but it makes it much easier to write triggers.
                        let overrideResult = "active";
                        if (this.cfg.stateOverride && this.cfg.stateOverride.length) {
                            overrideResult = evaluateOverride(this.cfg.stateOverride, this.name, "string");
                            if (overrideResult === OVERRIDE_NO_VALUE) {
                                overrideResult = "wait";
                            }
                        }

                        switch(overrideResult) {
                            case "wait":
                                // User asked us to stay in WaitOverrides state. Explicit no-op.
                                break;

                            case "active":
                                // User asked us to activate.
                                transition(AdvTriggerState.Active);
                                break;

                            case "irrelevant":
                                // User asked us to mark as irrelevant (early completion).
                                transition(AdvTriggerState.Irrelevant);
                                break;

                            default:
                                // ???
                                throw `${displayName} state override returned invalid state '${overrideResult}'`;
                        }
                        break;

                    case AdvTriggerState.Active:
                        if (this.actionIsComplete()) {
                            transition(AdvTriggerState.Complete);
                            break;
                        }
                        break;
                }
            } while(transitioned);

            if (everTransitioned) {
                this.renderStatus();
                this.parent.notifyTriggerStateChange(this);
                this.needsUpdate = AdvTriggerNonUpdateStates.includes(this.state);
            }
        }

        /* Call when .cfg is changed */
        notifyCfgChanged() {
            this.state = AdvTriggerState.Default;
            this.needsUpdate = true;
        }

        render() {
            this.tr.innerHTML = `
                <td class="advtrigger-sortable-dragger">::</td>
                <td class="advtrigger-when-type">
                <select>
                </select>
                </td>
                <td class="advtrigger-requirement-id">
                <input type="text" value="${this.cfg.requirementId}">
                </td>
                <td class="advtrigger-requirement-count">
                <input type="number" value="${this.cfg.requirementCount}">
                </td>
                <td class="advtrigger-overrides">
                <button class="advtrigger-overrides">(${this.cfg.stateOverride.length})</button>
                </td>
                <td class="advtrigger-action-type">
                <select></select>
                </td>
                <td class="advtrigger-action-id">
                <input type="text" value="${this.cfg.actionId}">
                </td>
                <td class="advtrigger-action-count">
                <input type="number" value="${this.cfg.actionCount}">
                </td>
                <td class="advtrigger-status">Default</td>
                <td class="advtrigger-buttons"><button class="advtrigger-advsettings">Set</button><button class="advtrigger-del">Del</button></td>
            `;
            this.rendered = true;
            this.renderStatus();
        }

        renderStatus() {
            if(!this.rendered) return;
            this.tr.querySelector(".advtrigger-status").innerText = AdvTriggerStateNames[this.state] ?? "Unknown";
        }
    }

    class AdvTriggerFolder {
        /** @type {string} */
        id;
        /** @type {AdvTriggerFolder|null} Parent folder, if any */
        parent = null;
        /** @type {AdvTriggerFolder[]} All sub folders regardless of state */
        subFolders = [];
        /** @type {AdvTrigger[]} All sub triggers regardless of state */
        subTriggers = [];

        /** @type {boolean} Enabled state last time updateEnabledState ran. Based on conditions. */
        enabled = false;
        /** @type {AdvTrigger[]} Triggers in active state */
        activeTriggers = [];

        div = document.createElement("div");
        rendered = false;

        /**
         * @typedef {Object} AdvTriggerFolderCfg
         * @property {string} name
         * @property {boolean} enabled
         * @property {boolean} exclusive
         * @property {Array} enabledOverride
         * @property {AdvTriggerCfg[]} triggers
         * @property {AdvTriggerFolderCfg[]} folders
         */
        /** @type {AdvTriggerFolderCfg} cfg */
        cfg = {};

        constructor(id, cfg) {
            this.id = id;
            this.cfg = Object.assign(this.defaultConfig(), cfg);
            this.div.dataset.folderId = id;

            this.importCfg();
            this.render();
        }

        /** @returns {AdvTriggerFolderCfg} */
        static defaultConfig() {
            return {
                name: "New Folder",
                enabled: true,
                exclusive: false,
                enabledOverride: [],
                triggers: [],
                folders: []
            };
        }

        importCfg() {
            for (let subfolder of this.cfg.folders) {
                this.subFolders.push(new AdvTriggerFolder(AdvTriggerManager.getUniqueId('advtrgfolder'), subfolder));
            }
            for (let trg of this.cfg.triggers) {
                this.subTriggers.push(new AdvTrigger(AdvTriggerManager.getUniqueId(), this, trg));
            }
        }

        _getEnabledState() {
            let overrideResult = evaluateOverride(this.cfg.enabledOverride, `AdvTrigger Folder ${this.cfg.name}`, "boolean");
            return typeof overrideResult === "boolean" ? overrideResult : this.cfg.enabled;
        }
        /** @returns {boolean} Whether the state *changed*. *Not* the new state! Grab state from .enabled. */
        updateEnabledState() {
            let newState = this._getEnabledState();
            if (newState !== this.enabled) {
                this.enabled = newState;
                return true;
            }
            return false;
        }

        updateActiveTriggers() {
            this.activeTriggers = [];
            if (!this.enabled) {
                return;
            }

            this.activeTriggers = this.subTriggers.filter(trg => {
                trg.updateState();
                return trg.state === AdvTriggerState.Active;
            });
        }

        /**
         * @param {AdvTrigger} trigger
         * @returns {AdvTrigger|null}
         */
        chainTriggerFor(trigger) {
            let idx = this.subTriggers.indexOf(trigger);
            return this.subTriggers[idx - 1] || null;
        }

        /** @param {AdvTrigger} changedTrigger */
        notifyTriggerStateChange(changedTrigger) {
            // TODO: Caching active triggers
        }

        render() {
            this.div.innerHTML = `
                <table style="margin-left: 10px" class="trigger-folder-table">
                    <caption style="caption-side: top">${this.cfg.name}</caption>
                    <thead>
                        <tr>
                            <th scope="col">::</th>
                            <th scope="col" colspan="3">When</th>
                            <th scope="col">Req</th>
                            <th scope="col" colspan="3">Action</th>
                            <th scope="col">Status</th>
                            <th scope="col">Setting</th>
                        </tr>
                    </thead>
                    <tbody class="advtrigger-subfolders"></tbody>
                    <tbody class="advtrigger-subfolder-add"></tbody>
                    <tbody class="advtrigger-subtriggers"></tbody>
                    <tbody class="advtrigger-subtrigger-add"></tbody>
                </table>
            `;
            this.rendered = true;
            this.renderFolders();
            this.renderTriggers();
            this.renderAddButtons();
        }
        renderFolders() {
            let tbody = this.div.querySelector("tbody.advtrigger-subfolders");
            for (let subfolder of this.subFolders) {
                subfolder.render();
                tbody.append(subfolder.div);
            }
        }
        renderTriggers() {
            let tbody = this.div.querySelector("tbody.advtrigger-subtriggers");
            for (let trg of this.subTriggers) {
                trg.render();
                tbody.append(trg.div);
            }
        }
        renderAddButtons() {
            this.div.querySelector("tbody.advtrigger-subfolder-add").appendChild(
                document.createElement("button")
            );

        }
    }

    /** @typedef {AdvTrigger|AdvTriggerFolder} AdvTriggerUIRenderable */
    // This holds all AdvTrigger related UI code.
    // It's a little messy because relying on the game's Vue will probably break as the game updates, and this really wants it.
    class AdvTriggerUIElement {
        /** @type {WeakMap<AdvTriggerUIRenderable, AdvTriggerUIElement>} */
        static elementMap = new WeakMap();

        /** @param {AdvTriggerUIRenderable} el */
        static getForElement(el) {
            if(this.elementMap[el]) {
                return this.elementMap[el];
            }

            this.elementMap[el] = new AdvTriggerUIElement(el);
            return this.elementMap[el];
        }

        /** @type {AdvTriggerUIRenderable} */
        #obj;
        /** @type {HTMLElement} */
        elem;

        /** @param {AdvTriggerUIRenderable} obj */
        constructor(obj) {
            this.#obj = obj;
            this._initElem();
        }

        _initElem() {

        }

        // Fully renders the element.
        fullRender() {

        }

        // Updates a minimal set of things.
        fastRender() {

        }

    }

    class AdvTriggerManager {
        static #nextUniqueId = 1; // Used in HTML to give elements an unique ID for drag/drop. Not saved in settings.

        /** @type {AdvTriggerFolder[]} */
        static rootFolders = [];
        /** @type {AdvTriggerFolder[]} Flattened active folder state. Includes subfolders. */
        static activeFolders = [];
        /** @type {AdvTriggerFolder|null} */
        static currentExclusiveFolder = null;

        static settingsDiv = document.createElement("div");

        /** @type {AdvTrigger[]} Export. */
        static activeHighPriorityTriggers = [];
        /** @type {AdvTrigger[]} Export. */
        static activeLowPriorityTriggers = [];

        static getUniqueId(what) {
            return `${what || 'advtrg'}-${this.#nextUniqueId++}`;
        }

        static updateFolders() {
            // This will end up updating this.activeFolders and this.currentExclusiveFolder, but not triggers.

            let exclusiveFolder = null;
            let somethingChanged = false;

            // need a shallow copy of this.rootFolders if no exclusive
            let activeFolders = this.currentExclusiveFolder ? [this.currentExclusiveFolder] : this.rootFolders.slice();

            /** @param {AdvTriggerFolder[]} folders */
            let iterateFolderArray = (folders) => {
                for (let folder of folders) {
                    if (folder.updateEnabledState()) {
                        somethingChanged = true;
                    }

                    if (folder.enabled) {
                        activeFolders.push(folder);
                        // If this folder is exclusive and this is the first time the loop runs, stop processing now.
                        // We'll run the loop again from the start in a bit.
                        if (folder.cfg.exclusive && !exclusiveFolder) {
                            exclusiveFolder = folder;
                            return;
                        }
                        else {
                            iterateFolderArray(folder.subFolders);
                        }
                    }
                }
            };

            // Are we currently in exclusive mode? If so, start at the exclusive folder, else the root folder.
            if (this.currentExclusiveFolder) {
                activeFolders = [this.currentExclusiveFolder];
                iterateFolderArray(this.currentExclusiveFolder);
            }
            else {
                activeFolders = [this.rootFolders];
                iterateFolderArray(this.rootFolders);
            }

            if (somethingChanged) {
                // Is there an exclusive folder now?
                if (exclusiveFolder) {
                    if (exclusiveFolder !== this.currentExclusiveFolder) {
                        // Re-run the recursive algorithm again.
                        // This time, we'll start from either the new exclusive folder, or the root if we just lost it.
                        // This is a little inefficient but this shouldn't be happening often enough for it to matter.
                        activeFolders = exclusiveFolder ? [exclusiveFolder] : this.rootFolders;
                        iterateFolderArray(activeFolders);
                        this.currentExclusiveFolder = exclusiveFolder;
                    }
                }
                else {
                    // No exclusive folder used.
                    this.currentExclusiveFolder = null;
                }

                this.activeFolders = activeFolders;

                return true;
            }
            else {
                // Nothing changed.
                return false;
            }
        }

        static updateTriggers() {
            this.activeHighPriorityTriggers = [];
            this.activeLowPriorityTriggers = [];

            let maxPriorityTriggers = [];
            let currentBestPriority = 1;

            this.activeFolders.forEach(folder => {
                folder.updateActiveTriggers();

                folder.activeTriggers.forEach(trg => {
                    let prio = trg.priority;
                    // -1 and 0 are special. We need cases for equal/lesser/higher priority.
                    if (prio === -1) {
                        // -1 prio triggers need to be added to high priority at the end, so we keep them apart.
                        maxPriorityTriggers.push(trg);
                    }
                    else if (prio < currentBestPriority) {
                        // This also handles prio 0 triggers as currentBestPriority starts at 1 and never goes down.
                        this.activeLowPriorityTriggers.push(trg);
                    }
                    else if (prio === currentBestPriority) {
                        this.activeHighPriorityTriggers.push(trg);
                    }
                    else if (prio > currentBestPriority) {
                        this.activeLowPriorityTriggers.push(...this.activeHighPriorityTriggers);
                        this.activeHighPriorityTriggers = [trg];
                        currentBestPriority = prio;
                    }
                    else {
                        throw `updateTriggers: unhandled priority case ${prio} ${currentBestPriority}`;
                    }
                });
            });

            this.activeHighPriorityTriggers.push(...maxPriorityTriggers);
        }

        static updateAll() {
            this.updateFolders();
            this.updateTriggers();
        }

        // Import settings from the user's store.
        static importSettings() {
            this.rootFolders = [];

            this.activeFolders = [];
            this.activeLowPriorityTriggers = [];
            this.activeHighPriorityTriggers = [];
            this.currentExclusiveFolder = null;

            // TODO: Error checking
            if (settingsRaw?.advTriggers?.rootFolders) {
                for (let fldCfg of settingsRaw.advTriggers.rootFolders) {
                    let folder = new AdvTriggerFolder(this.getUniqueId('advtrgroot'), fldCfg);
                    this.rootFolders.push(folder);
                }

            }
        }
    };

    var WindowManager = {
        openedByScript: false,
        _callbackWindowTitle: "",
        _callbackFunction: null,

        currentModalWindowTitle() {
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
        },

        openModalWindowWithCallback(elementToClick, callbackWindowTitle, callbackFunction) {
            if (this.isOpen()) {
                return;
            }

            this.openedByScript = true;
            this._callbackWindowTitle = callbackWindowTitle;
            this._callbackFunction = callbackFunction;
            elementToClick.click()
        },

        isOpen() {
            // Checks both the game modal window and our script modal window
            // game = modalBox
            // script = scriptModal
            return this.openedByScript || document.getElementById("modalBox") !== null || document.getElementById("scriptModal")?.style.display === "block";
        },

        checkCallbacks() {
            // We only care if the script itself opened the modal. If the user did it then ignore it.
            // There must be a call back function otherwise there is nothing to do.
            if (WindowManager.currentModalWindowTitle() === WindowManager._callbackWindowTitle &&
                    WindowManager.openedByScript && WindowManager._callbackFunction) {

                WindowManager._callbackFunction();

                let modalCloseBtn = document.querySelector('.modal .modal-close');
                if (modalCloseBtn !== null) {
                    modalCloseBtn.click();
                }
            } else {
                // If we hid users's modal - show it back
                let modal = document.querySelector('.modal');
                if (modal !== null) {
                    modal.style.display = "";
                }
            }

            WindowManager.openedByScript = false;
            WindowManager._callbackWindowTitle = "";
            WindowManager._callbackFunction = null;
        }
    }

    var KeyManager = {
        _setFn: null,
        _unsetFn: null,
        _allFn: null,
        _eventProp: {Shift: "shiftKey", Control: "ctrlKey", Alt: "altKey", Meta: "metaKey"},
        _state: {x100: undefined, x25: undefined, x10: undefined},
        _mode: "none",

        init() {
            let events = win.$._data(win.document).events;
            let set = events?.keydown?.[0]?.handler ?? null;
            let unset = events?.keyup?.[0]?.handler ?? null;
            let all = events?.mousemove?.[0]?.handler ?? null;

            if (!all && (!set || !unset)) { // Fallback, if there's no handlers in JQuery data
                this._setFn = (e) => document.dispatchEvent(new KeyboardEvent("keydown", e));
                this._unsetFn = (e) => document.dispatchEvent(new KeyboardEvent("keyup", e));
                this._allFn = null;
            } else if (typeof unsafeWindow !== 'undefined') { // FF fix
                this._setFn = (e) => set(cloneInto(e, unsafeWindow));
                this._unsetFn = (e) => unset(cloneInto(e, unsafeWindow));
                this._allFn = (e) => all(cloneInto(e, unsafeWindow));
            } else {
                this._setFn = set;
                this._unsetFn = unset;
                this._allFn = all;
            }
        },

        reset() {
            this._state.x100 = undefined;
            this._state.x25 = undefined;
            this._state.x10 = undefined;

            let map = game.global.settings.keyMap;
            let keys = Object.values(map);
            let uniq = ['x100', 'x25', 'x10'].every(key => keys.indexOf(map[key]) === keys.lastIndexOf(map[key]));

            if (!game.global.settings.mKeys) {
                this._mode = "none";
            } else if (keys.length !== uniq.length) {
                this._mode = "unset";
            } else if (this._allFn && ['x100', 'x25', 'x10'].every(key => ['Shift', 'Control', 'Alt', 'Meta'].includes(game.global.settings.keyMap[key]))) {
                this._mode = "all";
            } else {
                this._mode = "each";
            }
        },

        finish() {
            if (this._state.x100 || this._state.x25 || this._state.x10) {
                this.set(false, false, false);
            }
        },

        setKey(key, pressed) {
            if (this._state[key] === pressed) {
                return;
            }
            let fakeEvent = {key: game.global.settings.keyMap[key]};
            if (pressed) {
                this._setFn(fakeEvent);
            } else {
                this._unsetFn(fakeEvent);
            }
            this._state[key] = pressed;
        },

        set(x100, x25, x10) {
            if (this._mode === "all") {
                let map = game.global.settings.keyMap;
                let fakeEvent = {
                  [this._eventProp[map.x100]]: this._state.x100 = x100,
                  [this._eventProp[map.x25]]: this._state.x25 = x25,
                  [this._eventProp[map.x10]]: this._state.x10 = x10
                };
                this._allFn(fakeEvent);
            } else if (this._mode === "each" || this._mode === "unset") {
                this.setKey("x100", x100);
                this.setKey("x25", x25);
                this.setKey("x10", x10);
            }
        },

        *click(amount) {
            if (this._mode === "none") {
                while (amount > 0) {
                    yield amount -= 1;
                }
            } else if (this._mode === "unset") {
                this.set(false, false, false);
                while (amount > 0) {
                    yield amount -= 1;
                }
            } else {
                while (amount > 0) {
                    if (amount >= 25000) {
                        this.set(true, true, true);
                        yield amount -= 25000;
                    } else if (amount >= 2500) {
                        this.set(true, true, false);
                        yield amount -= 2500;
                    } else if (amount >= 1000) {
                        this.set(true, false, true);
                        yield amount -= 1000;
                    } else if (amount >= 250) {
                        this.set(false, true, true);
                        yield amount -= 250;
                    } else if (amount >= 100) {
                        this.set(true, false, false);
                        yield amount -= 100;
                    } else if (amount >= 25) {
                        this.set(false, true, false);
                        yield amount -= 25;
                    } else if (amount >= 10) {
                        this.set(false, false, true);
                        yield amount -= 10;
                    } else {
                        this.set(false, false, false);
                        yield amount -= 1;
                    }
                }
            }
        }
    }

    var GameLog = {
        Types: {
            special: "Specials",
            construction: "Construction",
            multi_construction: "Multi-part Construction",
            arpa: "A.R.P.A Progress",
            research: "Research",
            spying: "Spying",
            attack: "Attack",
            mercenary: "Mercenaries",
            mech_build: "Mech Build",
            mech_scrap: "Mech Scrap",
            outer_fleet: "True Path Fleet",
            mutation: "Mutations",
            prestige: "Prestige"
        },

        logInfo(loggingType, text, tags) {
            if (!settings.logEnabled || !settings["log_" + loggingType]) {
                return;
            }

            poly.messageQueue(text, "info", false, tags);
        },

        logSuccess(loggingType, text, tags) {
            if (!settings.logEnabled || !settings["log_" + loggingType]) {
                return;
            }

            poly.messageQueue(text, "success", false, tags);
        },

        logWarning(loggingType, text, tags) {
            if (!settings.logEnabled || !settings["log_" + loggingType]) {
                return;
            }

            poly.messageQueue(text, "warning", false, tags);
        },

        logDanger(loggingType, text, tags) {
            if (!settings.logEnabled || !settings["log_" + loggingType]) {
                return;
            }

            poly.messageQueue(text, "danger", false, tags);
        },
    }

    // Gui & Init functions
    function updateCraftCost() {
        if (state.lastWasteful === game.global.race.wasteful
                && state.lastHighPop === game.global.race.high_pop
                && state.lastFlier === game.global.race.flier) {
            return;
        }
        // Construct craftable resource list
        craftablesList = [];
        foundryList = [];
        for (let [name, costs] of Object.entries(game.craftCost)) {
            if (resources[name]) { // Ignore resources missed in script, such as Thermite
                resources[name].cost = {};
                for (let i = 0; i < costs.length; i++) {
                    resources[name].cost[costs[i].r] = costs[i].a;
                }
                craftablesList.push(resources[name]);
                if (name !== "Scarletite" && name !== "Quantium") {
                    foundryList.push(resources[name]);
                }
            }
        }
        state.lastWasteful = game.global.race.wasteful;
        state.lastHighPop = game.global.race.high_pop;
        state.lastFlier = game.global.race.flier;
    }

    function initialiseState() {
        updateCraftCost();
        updateTabs(false);

        // Lets set our crate / container resource requirements
        Object.defineProperty(resources.Crates, "cost", {get: () => isLumberRace() ? {Plywood: 10} : {Stone: 200}});
        resources.Containers.cost["Steel"] = 125;

        JobManager.craftingJobs = Object.values(crafter);

        // Construct city builds list
        //buildings.SacrificialAltar.gameMax = 1; // Although it is technically limited to single altar, we don't care about that, as we're going to click it to make sacrifices
        buildings.RedTerraformer.gameMax = 100;
        buildings.RedAtmoTerraformer.gameMax = 1;
        buildings.RedTerraform.gameMax = 1;
        buildings.GasSpaceDock.gameMax = 1;
        buildings.DwarfWorldController.gameMax = 1;
        buildings.GasSpaceDockShipSegment.gameMax = 100;
        buildings.ProximaDyson.gameMax = 100;
        buildings.BlackholeStellarEngine.gameMax = 100;
        buildings.DwarfWorldCollider.gameMax = 1859;
        buildings.DwarfShipyard.gameMax = 1;
        buildings.DwarfMassRelay.gameMax = 100;
        buildings.DwarfMassRelayComplete.gameMax = 1;
        buildings.TitanAI.gameMax = 100;
        buildings.TitanAIComplete.gameMax = 1;
        buildings.TritonFOB.gameMax = 1;

        buildings.SunJumpGate.gameMax = 100;
        buildings.TauJumpGate.gameMax = 100;
        buildings.TauAlienOutpost.gameMax = 1;
        buildings.TauStarRingworld.gameMax = 1000;
        buildings.TauStarMatrix.gameMax = 1;
        buildings.TauGas2AlienStation.gameMax = 100;
        buildings.TauGas2AlienSpaceStation.gameMax = 1;
        buildings.TauGas2MatrioshkaBrain.gameMax = 1000;
        buildings.TauGas2IgnitionDevice.gameMax = 10;

        buildings.ProximaDysonSphere.gameMax = 100;
        buildings.ProximaOrichalcumSphere.gameMax = 100;
        buildings.BlackholeStargate.gameMax = 200;
        buildings.BlackholeStargateComplete.gameMax = 1;
        buildings.SiriusSpaceElevator.gameMax = 100;
        buildings.SiriusGravityDome.gameMax = 100;
        buildings.SiriusAscensionMachine.gameMax = 100;
        buildings.SiriusAscensionTrigger.gameMax = 1;
        buildings.PitSoulForge.gameMax = 1;
        buildings.PitSoulCapacitor.gameMax = 40;
        buildings.PitAbsorptionChamber.gameMax = 100;
        buildings.GateEastTower.gameMax = 1;
        buildings.GateWestTower.gameMax = 1;
        buildings.RuinsVault.gameMax = 2;
        buildings.SpireBridge.gameMax = 10;
        buildings.GorddonEmbassy.gameMax = 1;
        buildings.Alien1Consulate.gameMax = 1;
        projects.LaunchFacility.gameMax = 1;
        projects.ManaSyphon.gameMax = 80;

        buildings.CoalPower.addResourceConsumption(() => game.global.race.universe === "magic" ? resources.Mana : resources.Coal, () => game.global.race['environmentalist'] ? 0 : game.global.race.universe === "magic" ? 0.05 : 0.65);
        buildings.OilPower.addResourceConsumption(resources.Oil, () => game.global.race['environmentalist'] ? 0 : 0.65);
        buildings.FissionPower.addResourceConsumption(resources.Uranium, 0.1);
        buildings.TouristCenter.addResourceConsumption(resources.Food, 50);

        // Init support
        buildings.SpaceNavBeacon.addSupport(resources.Moon_Support);
        buildings.SpaceNavBeacon.addResourceConsumption(resources.Red_Support, () => haveTech("luna", 3) ? -1 : 0);

        buildings.MoonBase.addSupport(resources.Moon_Support);
        buildings.MoonIridiumMine.addSupport(resources.Moon_Support);
        buildings.MoonHeliumMine.addSupport(resources.Moon_Support);
        buildings.MoonObservatory.addSupport(resources.Moon_Support);

        buildings.RedSpaceport.addSupport(resources.Red_Support);
        buildings.RedTower.addSupport(resources.Red_Support);
        buildings.RedLivingQuarters.addSupport(resources.Red_Support);
        buildings.RedVrCenter.addSupport(resources.Red_Support);
        buildings.RedMine.addSupport(resources.Red_Support);
        buildings.RedFabrication.addSupport(resources.Red_Support);
        buildings.RedBiodome.addSupport(resources.Red_Support);
        buildings.RedExoticLab.addSupport(resources.Red_Support);

        buildings.SunSwarmControl.addSupport(resources.Sun_Support);
        buildings.SunSwarmSatellite.addSupport(resources.Sun_Support);

        buildings.BeltSpaceStation.addSupport(resources.Belt_Support);
        buildings.BeltEleriumShip.addSupport(resources.Belt_Support);
        buildings.BeltIridiumShip.addSupport(resources.Belt_Support);
        buildings.BeltIronShip.addSupport(resources.Belt_Support);

        buildings.AlphaStarport.addSupport(resources.Alpha_Support);
        buildings.AlphaHabitat.addSupport(resources.Alpha_Support);
        buildings.AlphaMiningDroid.addSupport(resources.Alpha_Support);
        buildings.AlphaProcessing.addSupport(resources.Alpha_Support);
        buildings.AlphaFusion.addSupport(resources.Alpha_Support);
        buildings.AlphaLaboratory.addSupport(resources.Alpha_Support);
        buildings.AlphaExchange.addSupport(resources.Alpha_Support);
        buildings.AlphaGraphenePlant.addSupport(resources.Alpha_Support);
        buildings.AlphaExoticZoo.addResourceConsumption(resources.Alpha_Support, 1);
        buildings.ProximaTransferStation.addSupport(resources.Alpha_Support);

        buildings.NebulaNexus.addSupport(resources.Nebula_Support);
        buildings.NebulaHarvester.addSupport(resources.Nebula_Support);
        buildings.NebulaEleriumProspector.addSupport(resources.Nebula_Support);

        buildings.GatewayStarbase.addSupport(resources.Gateway_Support);
        buildings.GatewayShipDock.addSupport(resources.Gateway_Support);
        buildings.BologniumShip.addSupport(resources.Gateway_Support);
        buildings.ScoutShip.addSupport(resources.Gateway_Support);
        buildings.CorvetteShip.addSupport(resources.Gateway_Support);
        buildings.FrigateShip.addSupport(resources.Gateway_Support);
        buildings.CruiserShip.addSupport(resources.Gateway_Support);
        buildings.Dreadnought.addSupport(resources.Gateway_Support);
        buildings.StargateStation.addSupport(resources.Gateway_Support);
        buildings.StargateTelemetryBeacon.addSupport(resources.Gateway_Support);

        buildings.Alien2Foothold.addSupport(resources.Alien_Support);
        buildings.Alien2ArmedMiner.addSupport(resources.Alien_Support);
        buildings.Alien2OreProcessor.addSupport(resources.Alien_Support);
        buildings.Alien2Scavenger.addSupport(resources.Alien_Support);

        buildings.LakeHarbour.addSupport(resources.Lake_Support);
        buildings.LakeBireme.addSupport(resources.Lake_Support);
        buildings.LakeTransport.addSupport(resources.Lake_Support);

        buildings.SpirePurifier.addSupport(resources.Spire_Support);
        buildings.SpirePort.addSupport(resources.Spire_Support);
        buildings.SpireBaseCamp.addSupport(resources.Spire_Support);
        buildings.SpireMechBay.addSupport(resources.Spire_Support);

        buildings.TitanElectrolysis.addSupport(resources.Titan_Support);
        buildings.TitanQuarters.addSupport(resources.Titan_Support);
        buildings.TitanMine.addSupport(resources.Titan_Support);
        buildings.TitanGraphene.addSupport(resources.Titan_Support);
        buildings.TitanDecoder.addResourceConsumption(resources.Titan_Support, 1);

        buildings.TitanSpaceport.addSupport(resources.Enceladus_Support);
        buildings.EnceladusWaterFreighter.addSupport(resources.Enceladus_Support);
        buildings.EnceladusZeroGLab.addSupport(resources.Enceladus_Support);
        buildings.EnceladusBase.addSupport(resources.Enceladus_Support);

        buildings.TitanElectrolysis.addResourceConsumption(resources.Electrolysis_Support, -1);
        buildings.TitanHydrogen.addResourceConsumption(resources.Electrolysis_Support, 1);

        buildings.ErisDrone.addSupport(resources.Eris_Support);
        buildings.ErisTrooper.addSupport(resources.Eris_Support);
        buildings.ErisTank.addSupport(resources.Eris_Support);

        buildings.TauOrbitalStation.addSupport(resources.Tau_Support);
        buildings.TauFarm.addSupport(resources.Tau_Support);
        buildings.TauColony.addSupport(resources.Tau_Support);
        buildings.TauFactory.addSupport(resources.Tau_Support);
        buildings.TauDiseaseLab.addSupport(resources.Tau_Support);
        buildings.TauMiningPit.addSupport(resources.Tau_Support);

        buildings.TauRedOrbitalPlatform.addSupport(resources.Tau_Red_Support);
        buildings.TauRedOverseer.addSupport(resources.Tau_Red_Support);
        buildings.TauRedWomlingVillage.addSupport(resources.Tau_Red_Support);
        buildings.TauRedWomlingFarm.addSupport(resources.Tau_Red_Support);
        buildings.TauRedWomlingMine.addSupport(resources.Tau_Red_Support);
        buildings.TauRedWomlingFun.addSupport(resources.Tau_Red_Support);
        buildings.TauRedWomlingLab.addSupport(resources.Tau_Red_Support);

        buildings.TauRedWomlingVillage.addResourceConsumption(resources.Womlings_Support, () => haveTech("womling_pop", 2) ? -6 : -5);
        buildings.TauRedWomlingFarm.addResourceConsumption(resources.Womlings_Support, () => buildings.TauRedWomlingFarm.autoStateSmart ? 2 : 0);
        buildings.TauRedWomlingLab.addResourceConsumption(resources.Womlings_Support, () => buildings.TauRedWomlingLab.autoStateSmart ? 1 : 0);
        buildings.TauRedWomlingMine.addResourceConsumption(resources.Womlings_Support, () => buildings.TauRedWomlingMine.autoStateSmart ? 6 : 0);

        buildings.TauBeltPatrolShip.addSupport(resources.Tau_Belt_Support);
        buildings.TauBeltMiningShip.addSupport(resources.Tau_Belt_Support);
        buildings.TauBeltWhalingShip.addSupport(resources.Tau_Belt_Support);

        // Init consumptions
        buildings.MoonBase.addResourceConsumption(resources.Oil, 2);
        buildings.RedSpaceport.addResourceConsumption(resources.Helium_3, 1.25);
        buildings.RedSpaceport.addResourceConsumption(resources.Food, () => game.global.race['cataclysm'] || game.global.race['orbit_decayed'] ? 2 : 25);
        buildings.RedFactory.addResourceConsumption(resources.Helium_3, 1);
        buildings.RedSpaceBarracks.addResourceConsumption(resources.Oil, 2);
        buildings.RedSpaceBarracks.addResourceConsumption(resources.Food, () => game.global.race['cataclysm'] || game.global.race['orbit_decayed'] ? 0 : 10);
        buildings.HellGeothermal.addResourceConsumption(resources.Helium_3, 0.5);
        buildings.GasMoonOutpost.addResourceConsumption(resources.Oil, 2);
        buildings.BeltSpaceStation.addResourceConsumption(resources.Food, () => game.global.race['cataclysm'] || game.global.race['orbit_decayed'] ? 1 : 10);
        buildings.BeltSpaceStation.addResourceConsumption(resources.Helium_3, 2.5);
        buildings.DwarfEleriumReactor.addResourceConsumption(resources.Elerium, 0.05);

        buildings.AlphaStarport.addResourceConsumption(resources.Food, 100);
        buildings.AlphaStarport.addResourceConsumption(resources.Helium_3, 5);
        buildings.AlphaFusion.addResourceConsumption(resources.Deuterium, 1.25);
        buildings.AlphaExoticZoo.addResourceConsumption(resources.Food, 12000);
        buildings.AlphaMegaFactory.addResourceConsumption(resources.Deuterium, 5);

        buildings.ProximaTransferStation.addResourceConsumption(resources.Uranium, 0.28);
        buildings.ProximaCruiser.addResourceConsumption(resources.Helium_3, 6);

        buildings.NeutronMiner.addResourceConsumption(resources.Helium_3, 3);

        buildings.GatewayStarbase.addResourceConsumption(resources.Helium_3, 25);
        buildings.GatewayStarbase.addResourceConsumption(resources.Food, 250);

        buildings.BologniumShip.addResourceConsumption(resources.Helium_3, 5);
        buildings.ScoutShip.addResourceConsumption(resources.Helium_3, 6);
        buildings.CorvetteShip.addResourceConsumption(resources.Helium_3, 10);
        buildings.FrigateShip.addResourceConsumption(resources.Helium_3, 25);
        buildings.CruiserShip.addResourceConsumption(resources.Deuterium, 25);
        buildings.Dreadnought.addResourceConsumption(resources.Deuterium, 80);

        buildings.GorddonEmbassy.addResourceConsumption(resources.Food, 7500);
        buildings.GorddonFreighter.addResourceConsumption(resources.Helium_3, 12);

        buildings.Alien1VitreloyPlant.addResourceConsumption(resources.Bolognium, 2.5);
        buildings.Alien1VitreloyPlant.addResourceConsumption(resources.Stanene, 1000);
        buildings.Alien1VitreloyPlant.addResourceConsumption(resources.Money, 50000);
        buildings.Alien1SuperFreighter.addResourceConsumption(resources.Helium_3, 25);

        buildings.Alien2Foothold.addResourceConsumption(resources.Elerium, 2.5);
        buildings.Alien2ArmedMiner.addResourceConsumption(resources.Helium_3, 10);
        buildings.Alien2Scavenger.addResourceConsumption(resources.Helium_3, 12);

        buildings.ChthonianMineLayer.addResourceConsumption(resources.Helium_3, 8);
        buildings.ChthonianRaider.addResourceConsumption(resources.Helium_3, 18);

        buildings.RuinsInfernoPower.addResourceConsumption(resources.Infernite, 5);
        buildings.RuinsInfernoPower.addResourceConsumption(resources.Coal, 100);
        buildings.RuinsInfernoPower.addResourceConsumption(resources.Oil, 80);

        buildings.TitanElectrolysis.addResourceConsumption(resources.Water, 35);

        buildings.TitanQuarters.addResourceConsumption(resources.Water, 12);
        buildings.TitanQuarters.addResourceConsumption(resources.Food, 500);
        buildings.TitanDecoder.addResourceConsumption(resources.Cipher, 0.06);
        buildings.TitanAIComplete.addResourceConsumption(resources.Water, 1000);

        buildings.EnceladusWaterFreighter.addResourceConsumption(resources.Helium_3, 5);

        buildings.TritonFOB.addResourceConsumption(resources.Helium_3, 125);
        buildings.TritonLander.addResourceConsumption(resources.Oil, 50);

        buildings.KuiperOrichalcum.addResourceConsumption(resources.Oil, 200);
        buildings.KuiperUranium.addResourceConsumption(resources.Oil, 60);
        buildings.KuiperNeutronium.addResourceConsumption(resources.Oil, 60);
        buildings.KuiperElerium.addResourceConsumption(resources.Oil, 125);

        buildings.ErisDrone.addResourceConsumption(resources.Uranium, 5);

        buildings.TauOrbitalStation.addResourceConsumption(resources.Helium_3, () => haveTech("isolation") ? (game.global.race['lone_survivor'] ? 5 : 25) : 400);
        buildings.TauColony.addResourceConsumption(resources.Food, () => haveTech("isolation") ? (game.global.race['lone_survivor'] ? -2 : 75) : 1000);
        buildings.TauFusionGenerator.addResourceConsumption(resources.Helium_3, () => haveTech("isolation") ? (game.global.race['lone_survivor'] ? -15 : 75) : 500);
        buildings.TauCulturalCenter.addResourceConsumption(resources.Food, () => game.global.race['lone_survivor'] ? 25 : 500);
        buildings.TauRedOrbitalPlatform.addResourceConsumption(resources.Oil, () => game.global.race['lone_survivor'] ? 0 : (haveTech("isolation") ? 32 : 125));
        buildings.TauRedOrbitalPlatform.addResourceConsumption(resources.Helium_3, () => game.global.race['lone_survivor'] ? (haveTech("isolation") ? 8 : 125) : 0);
        buildings.TauBeltPatrolShip.addResourceConsumption(resources.Helium_3, () => haveTech("isolation") ? 15 : 250);
        buildings.TauBeltMiningShip.addResourceConsumption(resources.Helium_3, () => haveTech("isolation") ? 12 : 75);
        buildings.TauBeltWhalingShip.addResourceConsumption(resources.Helium_3, () => haveTech("isolation") ? 14 : 90);
        buildings.TauGas2AlienSpaceStation.addResourceConsumption(resources.Elerium, () => game.global.race['lone_survivor'] ? 1 : 10);

        // Better back compatibility, to run beta version's script on stable game build without commenting out new buildings
        buildings = Object.fromEntries(Object.entries(buildings).filter(([id, b]) =>
          b.definition ? true : console.log(`${b.name} action not found.`)));

        // These are buildings which are specified as powered in the actions definition game code but aren't actually powered in the main.js powered calculations
        Object.values(buildings).forEach(building => {
            if (building.powered > 0) {
                let powerId = (building._location || building._tab) + ":" + building.id;
                if (game.global.power.indexOf(powerId) === -1) {
                    building.overridePowered = 0;
                }
            }
        });
        //Object.defineProperty(buildings.Assembly, "overridePowered", {get: () => traitVal('powered', 0)});
        //Object.defineProperty(buildings.RedAssembly, "overridePowered", {get: () => traitVal('powered', 0)});
        buildings.Windmill.overridePowered = -1;
        buildings.SunSwarmSatellite.overridePowered = -0.35;
        buildings.ProximaDyson.overridePowered = -1.25;
        buildings.ProximaDysonSphere.overridePowered = -5;
        buildings.ProximaOrichalcumSphere.overridePowered = -8;
        // Numbers aren't exactly correct. That's fine - it won't mess with calculations - it's not something we can turn off and on. We just need to know that they *are* power generators, for autobuild, and that's enough for us.
        // And it doesn't includes Stellar Engine at all. It can generate some power... But only when fully built, and you don't want to build 100 levels of engine just to generate 20MW.
    }

    function initialiseRaces() {
        for (let id in game.actions.evolution) {
            evolutions[id] = new EvolutionAction(id);
        }
        let e = evolutions;

        let bilateralSymmetry = [e.bilateral_symmetry, e.multicellular, e.phagocytosis, e.sexual_reproduction];
        let mammals = [e.mammals, ...bilateralSymmetry];

        let genusEvolution = {
            eldritch: [e.sentience, e.eldritch, ...bilateralSymmetry],
            aquatic: [e.sentience, e.aquatic, ...bilateralSymmetry],
            insectoid: [e.sentience, e.athropods, ...bilateralSymmetry],
            humanoid: [e.sentience, e.humanoid, ...mammals],
            giant: [e.sentience, e.gigantism, ...mammals],
            small: [e.sentience, e.dwarfism, ...mammals],
            carnivore: [e.sentience, e.carnivore, e.animalism, ...mammals],
            herbivore: [e.sentience, e.herbivore, e.animalism, ...mammals],
            //omnivore: [e.sentience, e.omnivore, e.animalism, ...mammals],
            demonic: [e.sentience, e.demonic, ...mammals],
            angelic: [e.sentience, e.celestial, ...mammals],
            fey: [e.sentience, e.fey, ...mammals],
            heat: [e.sentience, e.heat, ...mammals],
            polar: [e.sentience, e.polar, ...mammals],
            sand: [e.sentience, e.sand, ...mammals],
            avian: [e.sentience, e.endothermic, e.eggshell, ...bilateralSymmetry],
            reptilian: [e.sentience, e.ectothermic, e.eggshell, ...bilateralSymmetry],
            plant: [e.sentience, e.bryophyte, e.poikilohydric, e.multicellular, e.chloroplasts, e.sexual_reproduction],
            fungi: [e.sentience, e.bryophyte, e.spores, e.multicellular, e.chitin, e.sexual_reproduction],
            synthetic: [e.sentience, e.exterminate, e.sexual_reproduction],
        }

        for (let id in game.races) {
            // We don't care about protoplasm
            if (id === "protoplasm") {
                continue;
            }

            races[id] = new Race(id);
            // Use fungi as default Valdi genus
            let evolutionPath = (id === "junker" || id === "sludge") ? genusEvolution.fungi : genusEvolution[races[id].genus];
            races[id].evolutionTree = [e.bunker, e[id], ...(evolutionPath ?? [])];

            // add imitate races
            imitations[id] = new EvolutionAction(`s-${id}`);
        }
    }

    function initBuildingState() {
        let priorityList = [];

        priorityList.push(buildings.Windmill);
        priorityList.push(buildings.Mill);
        priorityList.push(buildings.CoalPower);
        priorityList.push(buildings.OilPower);
        priorityList.push(buildings.FissionPower);
        priorityList.push(buildings.TauFusionGenerator);
        priorityList.push(buildings.TauGas2AlienSpaceStation);

        priorityList.push(buildings.RuinsHellForge);
        priorityList.push(buildings.RuinsInfernoPower);

        priorityList.push(buildings.TitanElectrolysis);
        priorityList.push(buildings.TitanHydrogen);
        priorityList.push(buildings.TitanQuarters);

        priorityList.push(buildings.DwarfMassRelayComplete);
        priorityList.push(buildings.RuinsArcology);
        priorityList.push(buildings.Apartment);
        priorityList.push(buildings.Barracks);
        priorityList.push(buildings.TouristCenter);
        priorityList.push(buildings.University);
        priorityList.push(buildings.Smelter);
        priorityList.push(buildings.Temple);
        priorityList.push(buildings.OilWell);
        priorityList.push(buildings.StorageYard);
        priorityList.push(buildings.Warehouse);
        priorityList.push(buildings.Bank);
        priorityList.push(buildings.Hospital);
        priorityList.push(buildings.BootCamp);
        priorityList.push(buildings.House);
        priorityList.push(buildings.Cottage);
        priorityList.push(buildings.Farm);
        priorityList.push(buildings.Silo);
        priorityList.push(buildings.Shed);
        priorityList.push(buildings.LumberYard);
        priorityList.push(buildings.Foundry);
        priorityList.push(buildings.OilDepot);
        priorityList.push(buildings.Trade);
        priorityList.push(buildings.Amphitheatre);
        priorityList.push(buildings.Library);
        priorityList.push(buildings.Wharf);
        priorityList.push(buildings.NaniteFactory); // Deconstructor trait
        priorityList.push(buildings.RedNaniteFactory); // Deconstructor trait & Cataclysm only
        priorityList.push(buildings.TauNaniteFactory); // Deconstructor trait & True Path only
        priorityList.push(buildings.Transmitter); // Artifical trait
        priorityList.push(buildings.Assembly); // Artifical trait
        priorityList.push(buildings.RedAssembly); // Artifical trait & Cataclysm only
        priorityList.push(buildings.TauAssembly); // Artifical trait & True Path only
        priorityList.push(buildings.TauCloning); // Sterile assembly
        priorityList.push(buildings.Lodge); // Carnivore/Detritivore/Soul Eater trait
        priorityList.push(buildings.Smokehouse); // Carnivore trait
        priorityList.push(buildings.SoulWell); // Soul Eater trait
        priorityList.push(buildings.SlavePen); // Slaver trait
        priorityList.push(buildings.SlaveMarket); // Slaver trait
        priorityList.push(buildings.CaptiveHousing); // Unfathomable trait
        priorityList.push(buildings.RedCaptiveHousing); // Unfathomable trait
        priorityList.push(buildings.TauCaptiveHousing); // Unfathomable trait
        priorityList.push(buildings.Graveyard); // Evil trait
        priorityList.push(buildings.Shrine); // Magnificent trait
        priorityList.push(buildings.CompostHeap); // Detritivore trait
        priorityList.push(buildings.ConcealWard); // Witch Hunting only
        priorityList.push(buildings.Pylon); // Magic Universe only
        priorityList.push(buildings.RedPylon); // Magic Universe & Cataclysm only
        priorityList.push(buildings.TauPylon); // Magic Universe & True Path only
        priorityList.push(buildings.ForgeHorseshoe); // Hooved trait
        priorityList.push(buildings.RedForgeHorseshoe); // Hooved trait
        priorityList.push(buildings.TauForgeHorseshoe); // Hooved trait
        priorityList.push(buildings.SacrificialAltar); // Cannibalize trait
        priorityList.push(buildings.MeditationChamber); // Calm trait

        priorityList.push(buildings.DwarfMission);
        priorityList.push(buildings.DwarfEleriumReactor);
        priorityList.push(buildings.DwarfWorldCollider);

        priorityList.push(buildings.HellMission);
        priorityList.push(buildings.HellGeothermal);
        priorityList.push(buildings.HellSwarmPlant);

        priorityList.push(buildings.ProximaTransferStation);
        priorityList.push(buildings.ProximaMission);
        priorityList.push(buildings.ProximaCargoYard);
        priorityList.push(buildings.ProximaCruiser);
        priorityList.push(buildings.ProximaDyson);
        priorityList.push(buildings.ProximaDysonSphere);
        priorityList.push(buildings.ProximaOrichalcumSphere);

        priorityList.push(buildings.AlphaMission);
        priorityList.push(buildings.AlphaStarport);
        priorityList.push(buildings.AlphaFusion);
        priorityList.push(buildings.AlphaHabitat);
        priorityList.push(buildings.AlphaLuxuryCondo);
        priorityList.push(buildings.AlphaMiningDroid);
        priorityList.push(buildings.AlphaProcessing);
        priorityList.push(buildings.AlphaLaboratory);
        priorityList.push(buildings.AlphaExoticZoo);
        priorityList.push(buildings.AlphaExchange);
        priorityList.push(buildings.AlphaGraphenePlant);
        priorityList.push(buildings.AlphaWarehouse);

        priorityList.push(buildings.SpaceTestLaunch);
        priorityList.push(buildings.SpaceSatellite);
        priorityList.push(buildings.SpaceGps);
        priorityList.push(buildings.SpacePropellantDepot);
        priorityList.push(buildings.SpaceNavBeacon);

        priorityList.push(buildings.RedMission);
        priorityList.push(buildings.RedTower);
        priorityList.push(buildings.RedSpaceport);
        priorityList.push(buildings.RedLivingQuarters);
        priorityList.push(buildings.RedBiodome);
        priorityList.push(buildings.RedSpaceBarracks);
        priorityList.push(buildings.RedExoticLab);
        priorityList.push(buildings.RedFabrication);
        priorityList.push(buildings.RedMine);
        priorityList.push(buildings.RedVrCenter);
        priorityList.push(buildings.RedZiggurat);
        priorityList.push(buildings.RedGarage);
        priorityList.push(buildings.RedUniversity);
        priorityList.push(buildings.RedTerraformer);
        //priorityList.push(buildings.RedTerraform);

        priorityList.push(buildings.MoonMission);
        priorityList.push(buildings.MoonBase);
        priorityList.push(buildings.MoonObservatory);
        priorityList.push(buildings.MoonHeliumMine);
        priorityList.push(buildings.MoonIridiumMine);

        priorityList.push(buildings.SunMission);
        priorityList.push(buildings.SunSwarmControl);
        priorityList.push(buildings.SunSwarmSatellite);
        priorityList.push(buildings.SunJumpGate);

        priorityList.push(buildings.GasMission);
        priorityList.push(buildings.GasStorage);
        priorityList.push(buildings.GasSpaceDock);
        priorityList.push(buildings.GasSpaceDockProbe);
        priorityList.push(buildings.GasSpaceDockGECK);
        priorityList.push(buildings.GasSpaceDockShipSegment);

        priorityList.push(buildings.GasMoonMission);
        priorityList.push(buildings.GasMoonDrone);

        priorityList.push(buildings.Blackhole);
        priorityList.push(buildings.BlackholeStellarEngine);
        priorityList.push(buildings.BlackholeJumpShip);
        priorityList.push(buildings.BlackholeWormholeMission);
        priorityList.push(buildings.BlackholeStargate);

        priorityList.push(buildings.SiriusMission);
        priorityList.push(buildings.SiriusAnalysis);
        priorityList.push(buildings.SiriusSpaceElevator);
        priorityList.push(buildings.SiriusGravityDome);
        priorityList.push(buildings.SiriusThermalCollector);
        priorityList.push(buildings.SiriusAscensionMachine);
        //priorityList.push(buildings.SiriusAscend); // This is performing the actual ascension. We'll deal with this in prestige automation

        priorityList.push(buildings.BlackholeStargateComplete); // Should be powered before Andromeda

        priorityList.push(buildings.GatewayMission);
        priorityList.push(buildings.GatewayStarbase);
        priorityList.push(buildings.GatewayShipDock);

        priorityList.push(buildings.StargateStation);
        priorityList.push(buildings.StargateTelemetryBeacon);

        priorityList.push(buildings.Dreadnought);
        priorityList.push(buildings.CruiserShip);
        priorityList.push(buildings.FrigateShip);
        priorityList.push(buildings.BologniumShip);
        priorityList.push(buildings.CorvetteShip);
        priorityList.push(buildings.ScoutShip);

        priorityList.push(buildings.GorddonMission);
        priorityList.push(buildings.GorddonEmbassy);
        priorityList.push(buildings.GorddonDormitory);
        priorityList.push(buildings.GorddonSymposium);
        priorityList.push(buildings.GorddonFreighter);

        priorityList.push(buildings.NeutronCitadel); // TODO: Having it bellow ascension/terraformer cause flickering when it disables, reduces quantum level, and it disables solar swarms reducing power.
        priorityList.push(buildings.SiriusAscensionTrigger); // This is the 10,000 power one, buildings below this one should be safe to underpower for ascension. Buildings above this either provides, or support population
        priorityList.push(buildings.RedAtmoTerraformer); // Orbit Decay terraformer, 5,000 power
        priorityList.push(buildings.BlackholeMassEjector); // Top priority of safe buildings, disable *only* for ascension, otherwise we want to have them on at any cost, to keep pumping black hole
        priorityList.push(buildings.PitSoulForge);

        priorityList.push(buildings.Alien1Consulate);
        priorityList.push(buildings.Alien1Resort);
        priorityList.push(buildings.Alien1VitreloyPlant);
        priorityList.push(buildings.Alien1SuperFreighter);

        //priorityList.push(buildings.Alien2Mission);
        priorityList.push(buildings.Alien2Foothold);
        priorityList.push(buildings.Alien2Scavenger);
        priorityList.push(buildings.Alien2ArmedMiner);
        priorityList.push(buildings.Alien2OreProcessor);

        //priorityList.push(buildings.ChthonianMission);
        priorityList.push(buildings.ChthonianMineLayer);
        priorityList.push(buildings.ChthonianExcavator);
        priorityList.push(buildings.ChthonianRaider);

        priorityList.push(buildings.Wardenclyffe);
        priorityList.push(buildings.BioLab);
        priorityList.push(buildings.DwarfWorldController);
        priorityList.push(buildings.BlackholeFarReach);

        priorityList.push(buildings.NebulaMission);
        priorityList.push(buildings.NebulaNexus);
        priorityList.push(buildings.NebulaHarvester);
        priorityList.push(buildings.NebulaEleriumProspector);

        priorityList.push(buildings.BeltMission);
        priorityList.push(buildings.BeltSpaceStation);
        priorityList.push(buildings.BeltEleriumShip);
        priorityList.push(buildings.BeltIridiumShip);
        priorityList.push(buildings.BeltIronShip);

        priorityList.push(buildings.CementPlant);
        priorityList.push(buildings.Factory);
        priorityList.push(buildings.GasMoonOutpost);
        priorityList.push(buildings.StargateDefensePlatform);
        priorityList.push(buildings.RedFactory);
        priorityList.push(buildings.AlphaMegaFactory);

        priorityList.push(buildings.PortalTurret);
        priorityList.push(buildings.BadlandsSensorDrone);
        priorityList.push(buildings.PortalWarDroid);
        priorityList.push(buildings.BadlandsPredatorDrone);
        priorityList.push(buildings.BadlandsAttractor);
        priorityList.push(buildings.PortalCarport);
        priorityList.push(buildings.PitGunEmplacement);
        priorityList.push(buildings.PitSoulAttractor);
        priorityList.push(buildings.PitSoulCapacitor);
        priorityList.push(buildings.PitAbsorptionChamber);
        priorityList.push(buildings.PortalRepairDroid);
        priorityList.push(buildings.PitMission);
        priorityList.push(buildings.PitAssaultForge);
        priorityList.push(buildings.RuinsAncientPillars);

        priorityList.push(buildings.RuinsMission);
        priorityList.push(buildings.RuinsGuardPost);
        priorityList.push(buildings.RuinsVault);
        priorityList.push(buildings.RuinsArchaeology);

        priorityList.push(buildings.GateMission);
        priorityList.push(buildings.GateEastTower);
        priorityList.push(buildings.GateWestTower);
        priorityList.push(buildings.GateTurret);
        priorityList.push(buildings.GateInferniteMine);

        priorityList.push(buildings.SpireMission);
        priorityList.push(buildings.SpirePurifier);
        priorityList.push(buildings.SpireMechBay);
        priorityList.push(buildings.SpireBaseCamp);
        priorityList.push(buildings.SpirePort);
        priorityList.push(buildings.SpireBridge);
        priorityList.push(buildings.SpireSphinx);
        priorityList.push(buildings.SpireBribeSphinx);
        priorityList.push(buildings.SpireSurveyTower);
        priorityList.push(buildings.SpireWaygate);

        priorityList.push(buildings.LakeMission);
        priorityList.push(buildings.LakeCoolingTower);
        priorityList.push(buildings.LakeHarbour);
        priorityList.push(buildings.LakeBireme);
        priorityList.push(buildings.LakeTransport);

        priorityList.push(buildings.HellSmelter);
        priorityList.push(buildings.DwarfShipyard);
        priorityList.push(buildings.DwarfMassRelay);
        priorityList.push(buildings.TitanMission);
        priorityList.push(buildings.TitanSpaceport);

        priorityList.push(buildings.TitanAIColonist);
        priorityList.push(buildings.TitanMine);
        priorityList.push(buildings.TitanSAM);
        priorityList.push(buildings.TitanGraphene);
        priorityList.push(buildings.TitanStorehouse);
        priorityList.push(buildings.TitanBank);
        priorityList.push(buildings.TitanAI);
        priorityList.push(buildings.TitanAIComplete);
        priorityList.push(buildings.TitanDecoder);
        priorityList.push(buildings.EnceladusMission);
        priorityList.push(buildings.EnceladusZeroGLab);
        priorityList.push(buildings.EnceladusWaterFreighter);
        priorityList.push(buildings.EnceladusBase);
        priorityList.push(buildings.EnceladusMunitions);
        priorityList.push(buildings.TritonMission);
        priorityList.push(buildings.TritonFOB);
        priorityList.push(buildings.TritonLander);
        //priorityList.push(buildings.TritonCrashedShip);
        priorityList.push(buildings.KuiperMission);
        priorityList.push(buildings.KuiperOrichalcum);
        priorityList.push(buildings.KuiperUranium);
        priorityList.push(buildings.KuiperNeutronium);
        priorityList.push(buildings.KuiperElerium);
        priorityList.push(buildings.ErisMission);
        priorityList.push(buildings.ErisDrone);
        priorityList.push(buildings.ErisTank);
        priorityList.push(buildings.ErisTrooper);
        //priorityList.push(buildings.ErisDigsite);

        priorityList.push(buildings.TauStarRingworld);
        priorityList.push(buildings.TauStarMatrix);
        //priorityList.push(buildings.TauStarBluePill);
        priorityList.push(buildings.TauStarEden);

        priorityList.push(buildings.TauMission);
        priorityList.push(buildings.TauDismantle);
        priorityList.push(buildings.TauOrbitalStation);
        priorityList.push(buildings.TauFarm);
        priorityList.push(buildings.TauColony);
        priorityList.push(buildings.TauHousing);
        priorityList.push(buildings.TauExcavate);
        priorityList.push(buildings.TauAlienOutpost);
        priorityList.push(buildings.TauJumpGate);
        priorityList.push(buildings.TauRepository);
        priorityList.push(buildings.TauFactory);
        priorityList.push(buildings.TauDiseaseLab);
        priorityList.push(buildings.TauCasino);
        priorityList.push(buildings.TauCulturalCenter);
        priorityList.push(buildings.TauMiningPit);

        priorityList.push(buildings.TauRedMission);
        priorityList.push(buildings.TauRedOrbitalPlatform);
        priorityList.push(buildings.TauRedContact);
        priorityList.push(buildings.TauRedIntroduce);
        priorityList.push(buildings.TauRedSubjugate);
        //priorityList.push(buildings.TauRedJeff);
        priorityList.push(buildings.TauRedWomlingVillage);
        priorityList.push(buildings.TauRedWomlingFarm);
        priorityList.push(buildings.TauRedWomlingLab);
        priorityList.push(buildings.TauRedWomlingMine);
        priorityList.push(buildings.TauRedWomlingFun);
        priorityList.push(buildings.TauRedOverseer);

        priorityList.push(buildings.TauGasContest);
        priorityList.push(buildings.TauGasName1);
        priorityList.push(buildings.TauGasName2);
        priorityList.push(buildings.TauGasName3);
        priorityList.push(buildings.TauGasName4);
        priorityList.push(buildings.TauGasName5);
        priorityList.push(buildings.TauGasName6);
        priorityList.push(buildings.TauGasName7);
        priorityList.push(buildings.TauGasName8);
        priorityList.push(buildings.TauGasRefuelingStation);
        priorityList.push(buildings.TauGasOreRefinery);
        priorityList.push(buildings.TauGasWhalingStation);
        priorityList.push(buildings.TauGasWomlingStation);

        priorityList.push(buildings.TauBeltMission);
        priorityList.push(buildings.TauBeltPatrolShip);
        priorityList.push(buildings.TauBeltMiningShip);
        priorityList.push(buildings.TauBeltWhalingShip);

        priorityList.push(buildings.TauGas2Contest);
        priorityList.push(buildings.TauGas2Name1);
        priorityList.push(buildings.TauGas2Name2);
        priorityList.push(buildings.TauGas2Name3);
        priorityList.push(buildings.TauGas2Name4);
        priorityList.push(buildings.TauGas2Name5);
        priorityList.push(buildings.TauGas2Name6);
        priorityList.push(buildings.TauGas2Name7);
        priorityList.push(buildings.TauGas2Name8);
        priorityList.push(buildings.TauGas2AlienSurvey);
        priorityList.push(buildings.TauGas2AlienStation);
        priorityList.push(buildings.TauGas2MatrioshkaBrain);
        priorityList.push(buildings.TauGas2IgnitionDevice);
        priorityList.push(buildings.TauGas2IgniteGasGiant);

        priorityList.push(buildings.StargateDepot);
        priorityList.push(buildings.DwarfEleriumContainer);

        priorityList.push(buildings.GasMoonOilExtractor);
        priorityList.push(buildings.NeutronMission);
        priorityList.push(buildings.NeutronStellarForge);
        priorityList.push(buildings.NeutronMiner);

        priorityList.push(buildings.MassDriver);
        priorityList.push(buildings.MetalRefinery);
        priorityList.push(buildings.Casino);
        priorityList.push(buildings.HellSpaceCasino);
        priorityList.push(buildings.RockQuarry);
        priorityList.push(buildings.Sawmill);
        priorityList.push(buildings.GasMining);
        priorityList.push(buildings.Mine);
        priorityList.push(buildings.CoalMine);

        BuildingManager.priorityList = priorityList.filter(b => b);
        BuildingManager.statePriorityList = priorityList.filter(b => b && b.isSwitchable());
    }

    function resetWarSettings(reset) {
        let def = {
            autoFight: false,
            foreignAttackLivingSoldiersPercent: 90,
            foreignAttackHealthySoldiersPercent: 90,
            foreignHireMercMoneyStoragePercent: 90,
            foreignHireMercCostLowerThanIncome: 1,
            foreignHireMercDeadSoldiers: 1,
            foreignMinAdvantage: 40,
            foreignMaxAdvantage: 80,
            foreignMaxSiegeBattalion: 10,
            foreignProtect: "auto",
            foreignPacifist: false,
            foreignUnification: true,
            foreignForceSabotage: true,
            foreignOccupyLast: true,
            foreignForceOccupy: false,
            foreignTrainSpy: true,
            foreignSpyMax: 2,
            foreignPowerRequired: 75,
            foreignPolicyInferior: "Annex",
            foreignPolicySuperior: "Sabotage",
            foreignPolicyRival: "Influence",
        }

        applySettings(def, reset);
    }

    function resetHellSettings(reset) {
        let def = {
            autoHell: false,
            hellHomeGarrison: 10,
            hellMinSoldiers: 20,
            hellMinSoldiersPercent: 90,
            hellAssaultReserve: true,
            hellTargetFortressDamage: 100,
            hellLowWallsMulti: 3,
            hellHandlePatrolSize: true,
            hellPatrolMinRating: 30,
            hellPatrolThreatPercent: 8,
            hellPatrolDroneMod: 5,
            hellPatrolDroidMod: 5,
            hellPatrolBootcampMod: 0,
            hellBolsterPatrolPercentTop: 50,
            hellBolsterPatrolPercentBottom: 20,
            hellBolsterPatrolRating: 300,
            hellAttractorTopThreat: 9000,
            hellAttractorBottomThreat: 6000,
        }

        applySettings(def, reset);
    }

    function resetGeneralSettings(reset) {
        let def = {
            masterScriptToggle: true,
            showSettings: true,
            autoPrestige: false,
            tickRate: 4,
            tickSchedule: false,
            researchRequest: true,
            researchRequestSpace: false,
            missionRequest: true,
            useDemanded: true,
            prioritizeTriggers: "savereq",
            prioritizeAdvTriggerHigh: "savereq",
            prioritizeAdvTriggerLow: "save",
            prioritizeQueue: "savereq",
            prioritizeUnify: "savereq",
            prioritizeOuterFleet: "ignore",
            buildingAlwaysClick: false,
            buildingClickPerTick: 50,
            activeTargetsUI: false,
            displayPrestigeTypeInTopBar: false,
            displayTotalDaysTypeInTopBar: false
        }

        applySettings(def, reset);
    }

    function resetPrestigeSettings(reset) {
        let def = {
            prestigeType: "none",
            prestigeMADIgnoreArpa: true,
            prestigeMADWait: true,
            prestigeMADPopulation: 1,
            prestigeWaitAT: false,
            prestigeGECK: 0,
            prestigeBioseedConstruct: true,
            prestigeBioseedProbes: 3,
            prestigeWhiteholeSaveGems: true,
            prestigeWhiteholeMinMass: 8,
            prestigeAscensionPillar: true,
            prestigeDemonicFloor: 100,
            prestigeDemonicPotential: 0.6,
            prestigeDemonicBomb: false,
            prestigeVaxStrat: "none",
        }

        applySettings(def, reset);
    }

    function resetGovernmentSettings(reset) {
        let def = {
            autoTax: false,
            autoGovernment: false,
            generalRequestedTaxRate: -1,
            generalMinimumTaxRate: 20,
            generalMinimumMorale: 105,
            generalMaximumMorale: 500,
            govInterim: GovernmentManager.Types.democracy.id,
            govFinal: GovernmentManager.Types.technocracy.id,
            govSpace: GovernmentManager.Types.corpocracy.id,
            govGovernor: "none",
        }

        applySettings(def, reset);
    }

    function resetEvolutionSettings(reset) {
        let def = {
            autoEvolution: false,
            userUniverseTargetName: "none",
            userPlanetTargetName: "none",
            userEvolutionTarget: "auto",
            evolutionQueue: [],
            evolutionQueueEnabled: false,
            evolutionQueueRepeat: false,
            evolutionAutoUnbound: true,
            evolutionBackup: false,
        }
        challenges.forEach(set => def["challenge_" + set[0].id] = false);

        applySettings(def, reset);
    }

    function resetResearchSettings(reset) {
        let def = {
            autoResearch: false,
            userResearchTheology_1: "auto",
            userResearchTheology_2: "auto",
            researchIgnore: ["tech-purify"],
        }

        applySettings(def, reset);
    }

    function resetMarketSettings(reset) {
        MarketManager.priorityList = Object.values(resources).filter(r => r.is.tradable).reverse();
        let def = {
            autoMarket: false,
            autoGalaxyMarket: false,
            tradeRouteMinimumMoneyPerSecond: 500,
            tradeRouteMinimumMoneyPercentage: 50,
            tradeRouteSellExcess: true,
            minimumMoney: 0,
            minimumMoneyPercentage: 0,
            marketMinIngredients: 0,
        }

        for (let i = 0; i < MarketManager.priorityList.length; i++) {
            let resource = MarketManager.priorityList[i];
            let id = resource.id;

            def['res_buy_p_' + id] = i; // marketPriority
            def['buy' + id] = false; // autoBuyEnabled
            def['res_buy_r_' + id] = 0.5; // autoBuyRatio
            def['sell' + id] = false; // autoSellEnabled
            def['res_sell_r_' + id] = 0.9; // autoSellRatio
            def['res_trade_buy_' + id] = true; // autoTradeBuyEnabled
            def['res_trade_sell_' + id] = true; // autoTradeSellEnabled
            def['res_trade_w_' + id] = 1; // autoTradeWeighting
            def['res_trade_p_' + id] = 1; // autoTradePriority
        }

        const setTradePriority = (priority, items) =>
          items.forEach(id => def['res_trade_p_' + id] = priority);

        setTradePriority(1, ["Food"]);
        setTradePriority(2, ["Helium_3", "Uranium", "Oil", "Coal"]);
        setTradePriority(3, ["Stone", "Chrysotile", "Lumber"]);
        setTradePriority(4, ["Aluminium", "Iron", "Copper"]);
        setTradePriority(5, ["Furs"]);
        setTradePriority(6, ["Cement"]);
        setTradePriority(7, ["Steel"]);
        setTradePriority(8, ["Titanium"]);
        setTradePriority(9, ["Polymer", "Alloy"]);
        setTradePriority(10, ["Iridium"]);
        setTradePriority(-1, ["Crystal"]);

        for (let i = 0; i < poly.galaxyOffers.length; i++) {
            let resource = resources[poly.galaxyOffers[i].buy.res];
            let id = resource.id;

            def['res_galaxy_w_' + id] = 1; // galaxyMarketWeighting
            def['res_galaxy_p_' + id] = i+1; // galaxyMarketPriority
        }

        applySettings(def, reset);
        MarketManager.sortByPriority();
    }

    function resetStorageSettings(reset) {
        StorageManager.priorityList = Object.values(resources).filter(r => r.hasStorage()).reverse();
        let def = {
            autoStorage: false,
            storageLimitPreMad: true,
            storageSafeReassign: true,
            storageAssignExtra: true,
            storageAssignPart: false
        }

        for (let i = 0; i < StorageManager.priorityList.length; i++) {
            let resource = StorageManager.priorityList[i];
            let id = resource.id;

            def['res_storage' + id] = true; // autoStorageEnabled
            def['res_storage_p_' + id] = i; // storagePriority
            def['res_storage_o_' + id] = false; // storeOverflow
            def['res_min_store' + id] = 1; // minStorage
            def['res_max_store' + id] = -1; // maxStorage
        }

        // Enable overflow for endgame resources
        def['res_storage_o_' + resources.Orichalcum.id] = true;
        def['res_storage_o_' + resources.Vitreloy.id] = true;
        def['res_storage_o_' + resources.Bolognium.id] = true;

        applySettings(def, reset);
        StorageManager.sortByPriority();
    }

    function resetMinorTraitSettings(reset) {
        MinorTraitManager.priorityList = Object.entries(game.traits)
          .filter(([id, trait]) => trait.type === 'minor' || id === 'mastery' || id === 'fortify')
          .map(([id, trait]) => new MinorTrait(id));

        let def = {
            autoMinorTrait: false,
            shifterGenus: "ignore",
            imitateRace: "ignore",
            buildingShrineType: "know",
            slaveIncome: 25000,
            jobScalePop: true,
            psychicPower: "auto",
            psychicBoostRes: "auto",

            autoGenetics: false,
            geneticsSequence: "none",
            geneticsBoost: "none",
            geneticsAssemble: "auto"
        };

        for (let i = 0; i < MinorTraitManager.priorityList.length; i++) {
            let trait = MinorTraitManager.priorityList[i];
            let id = trait.traitName;

            def['mTrait_' + id] = true; // enabled
            def['mTrait_p_' + id] = i; // priority
            def['mTrait_w_' + id] = 1; // weighting
        }

        applySettings(def, reset);
        MinorTraitManager.sortByPriority();
    }

    function resetMutableTraitSettings(reset) {
        let unobtainableTraits = ["xenophobic", "rigid", "soul_eater"];
        MutableTraitManager.priorityList = Object.entries(game.traits)
          .filter(([id, trait]) => (trait.type === "major" || trait.type === "genus") && !unobtainableTraits.includes(id))
          .map(([id, trait]) => trait.type === "major" ? new MajorTrait(id) : new GenusTrait(id))
          .sort((a, b) => Object.keys(poly.genus_traits).indexOf(a.genus) - Object.keys(poly.genus_traits).indexOf(b.genus) || a.type < b.type);

        let def = {
            autoMutateTraits: false,
            doNotGoBelowPlasmidSoftcap: true,
            minimumPlasmidsToPreserve: 0,
        };

        for (let i = 0; i < MutableTraitManager.priorityList.length; i++) {
            let trait = MutableTraitManager.priorityList[i];
            let id = trait.traitName;

            def["mutableTrait_p_" + id] = i; // priority
            def["mutableTrait_purge_" + id] = false; // auto remove disabled

            if (trait.isGainable()) {
                def["mutableTrait_gain_" + id] = false; // auto add disabled
            }
            if (poly.neg_roll_traits.includes(id)) {
                def["mutableTrait_reset_" + id] = false; // auto reset disabled
            }
        }

        applySettings(def, reset);
        MutableTraitManager.sortByPriority();
    }

    function resetJobSettings(reset) {
        JobManager.priorityList = Object.values(jobs);
        let def = {
            autoJobs: false,
            autoCraftsmen: false,
            jobSetDefault: true,
            jobManageServants: true,
            jobLumberWeighting: 50,
            jobQuarryWeighting: 50,
            jobCrystalWeighting: 50,
            jobScavengerWeighting: 5,
            jobRaiderWeighting: 20,
            jobDisableMiners: true,
        }

        for (let i = 0; i < JobManager.priorityList.length; i++) {
            let job = JobManager.priorityList[i];
            let id = job._originalId;

            def['job_' + id] = true; // autoJobEnabled
            def['job_p_' + id] = i; // priority

            if (job.is.smart) {
                def['job_s_' + id] = true; // smart
            }
        }

        const setBreakpoints = (job, b1, b2, b3) => { // breakpoins
            def['job_b1_' + job._originalId] = b1;
            def['job_b2_' + job._originalId] = b2;
            def['job_b3_' + job._originalId] = b3;
        };
        setBreakpoints(jobs.Colonist, -1, -1, -1);
        setBreakpoints(jobs.Teamster, 10, -1, -1);
        setBreakpoints(jobs.Hunter, -1, -1, -1);
        setBreakpoints(jobs.Farmer, -1, -1, -1);
        //setBreakpoints(jobs.Forager, 4, 10, 0);
        setBreakpoints(jobs.Lumberjack, 4, 10, 0);
        setBreakpoints(jobs.QuarryWorker, 4, 10, 0);
        setBreakpoints(jobs.CrystalMiner, 2, 5, 0);
        setBreakpoints(jobs.Scavenger, 0, 0, 0);

        setBreakpoints(jobs.TitanColonist, -1, -1, -1);
        setBreakpoints(jobs.PitMiner, 1, 12, -1);
        setBreakpoints(jobs.Miner, 3, 5, -1);
        setBreakpoints(jobs.CoalMiner, 2, 4, -1);
        setBreakpoints(jobs.CementWorker, 4, 8, -1);
        setBreakpoints(jobs.Professor, 6, 10, -1);
        setBreakpoints(jobs.Scientist, 3, 6, -1);
        setBreakpoints(jobs.Entertainer, 2, 5, -1);
        setBreakpoints(jobs.HellSurveyor, 1, 1, -1);
        setBreakpoints(jobs.SpaceMiner, 1, 3, -1);
        setBreakpoints(jobs.Torturer, 1, 1, -1);
        setBreakpoints(jobs.Archaeologist, 1, 1, -1);
        setBreakpoints(jobs.Banker, 3, 5, -1);
        setBreakpoints(jobs.Priest, 0, 0, -1);
        setBreakpoints(jobs.Unemployed, 0, 0, 0);

        applySettings(def, reset);
        JobManager.sortByPriority();
    }

    function resetWeightingSettings(reset) {
        let def = {
            buildingBuildIfStorageFull: false,
            buildingWeightingNew: 3,
            buildingWeightingUselessPowerPlant: 0.01,
            buildingWeightingNeedfulPowerPlant: 3,
            buildingWeightingUnderpowered: 0.8,
            buildingWeightingUselessKnowledge: 0.01,
            buildingWeightingNeedfulKnowledge: 5,
            buildingWeightingMissingFuel: 10,
            buildingWeightingNonOperatingCity: 0.2,
            buildingWeightingNonOperating: 0,
            buildingWeightingMissingSupply: 0,
            buildingWeightingMissingSupport: 0,
            buildingWeightingUselessSupport: 0.01,
            buildingWeightingMADUseless: 0,
            buildingWeightingUnusedEjectors: 0.1,
            buildingWeightingCrateUseless: 0.01,
            buildingWeightingHorseshoeUseless: 0.1,
            buildingWeightingZenUseless: 0.01,
            buildingWeightingGateTurret: 0.01,
            buildingWeightingNeedStorage: 1,
            buildingWeightingUselessHousing: 1,
            buildingWeightingTemporal: 0.2,
            buildingWeightingSolar: 0.2,
            buildingWeightingOverlord: 0,
        }

        applySettings(def, reset);
    }

    function resetBuildingSettings(reset) {
        initBuildingState();
        let def = {
            autoBuild: false,
            autoPower: false,
            buildingsIgnoreZeroRate: false,
            buildingsLimitPowered: true,
            buildingTowerSuppression: 100,
            buildingsTransportGem: false,
            buildingsBestFreighter: false,
            buildingsUseMultiClick: false,
            buildingEnabledAll: true,
            buildingStateAll: true
        }

        for (let i = 0; i < BuildingManager.priorityList.length; i++) {
            let building = BuildingManager.priorityList[i];
            let id = building._vueBinding;

            def['bat' + id] = true; // autoBuildEnabled
            def['bld_p_' + id] = i; // priority
            def['bld_m_' + id] = -1; // _autoMax
            def['bld_w_' + id] = 100; // _weighting

            if (building.isSwitchable()) {
                def['bld_s_' + id] = true; // autoStateEnabled
            }
            if (building.is.smart) {
                def['bld_s2_' + id] = true; // autoStateSmart
            }
        }
        // Moon smart is disabled by default
        def['bld_s2_space-iridium_mine'] = false;
        def['bld_s2_space-helium_mine'] = false;

        // AutoBuild disabled by default for early(ish) buildings consuming Soul Gems, Blood Stones and Plasmids
        // Same for Womling interaction action, and Gas names, as they are mutualy exclusive
        ["RedVrCenter", "NeutronCitadel", "PortalWarDroid", "BadlandsPredatorDrone", "PortalRepairDroid", "SpireWaygate",
         "TauRedContact", "TauRedIntroduce", "TauRedSubjugate",
         "TauGasName1", "TauGasName2", "TauGasName3", "TauGasName4", "TauGasName5", "TauGasName6", "TauGasName7", "TauGasName8",
         "TauGas2Name1", "TauGas2Name2", "TauGas2Name3", "TauGas2Name4", "TauGas2Name5", "TauGas2Name6", "TauGas2Name7", "TauGas2Name8"]
          .forEach(b => def['bat' + buildings[b]._vueBinding] = false);

        // Limit max for belt ships, and horseshoes
        def['bld_m_' + buildings.ForgeHorseshoe._vueBinding] = 20;
        def['bld_m_' + buildings.RedForgeHorseshoe._vueBinding] = 20;
        def['bld_m_' + buildings.TauForgeHorseshoe._vueBinding] = 20;
        def['bld_m_' + buildings.BeltEleriumShip._vueBinding] = 15;
        def['bld_m_' + buildings.BeltIridiumShip._vueBinding] = 15;

        applySettings(def, reset);
        BuildingManager.sortByPriority();
    }

    function resetProjectSettings(reset) {
        ProjectManager.priorityList = Object.values(projects);
        let def = {
            autoARPA: false,
            arpaScaleWeighting: true,
            arpaStep: 5,
        }

        let projectPriority = 0;
        const setProject = (item, autoBuildEnabled, _autoMax, _weighting) => {
            let id = projects[item].id;
            def['arpa_' + id] = autoBuildEnabled;
            def['arpa_p_' + id] = projectPriority++;
            def['arpa_m_' + id] = _autoMax;
            def['arpa_w_' + id] = _weighting;
        };
        setProject("LaunchFacility", true, -1, 100);
        setProject("SuperCollider", true, -1, 5);
        setProject("StockExchange", true, -1, 0.5);
        setProject("Monument", true, -1, 1);
        setProject("Railway", true, -1, 0.1);
        setProject("Nexus", true, -1, 1);
        setProject("RoidEject", true, -1, 1);
        setProject("ManaSyphon", false, 79, 1);
        setProject("Depot", true, -1, 1);

        applySettings(def, reset);
        ProjectManager.sortByPriority();
    }

    function resetMagicSettings(reset) {
        AlchemyManager.priorityList = Object.values(resources).filter(r => AlchemyManager.transmuteTier(r) > 0);
        let def = {
            autoAlchemy: false,
            autoPylon: false,
            magicAlchemyManaUse: 0.5,
            productionRitualManaUse: 0.5,
            productionRitualSafe: true,
        }

        // Alchemy
        for (let i = 0; i < AlchemyManager.priorityList.length; i++) {
            let resource = AlchemyManager.priorityList[i];
            let id = resource.id;

            def['res_alchemy_' + id] = true; // resEnabled
            def['res_alchemy_w_' + id] = 0; // resWeighting
        }

        // Pylon
        for (let spell of Object.values(RitualManager.Productions)) {
            def['spell_w_' + spell.id] = 100; // weighting
        }
        def['spell_w_hunting'] = 10;
        def['spell_w_farmer'] = 1;

        applySettings(def, reset);
    }

    function resetProductionSettings(reset) {
        let def = {
            autoQuarry: false,
            autoMine: false,
            autoExtractor: false,
            autoGraphenePlant: false,
            autoSmelter: false,
            autoCraft: false,
            autoFactory: false,
            autoMiningDroid: false,
            autoReplicator: false,
            productionChrysotileWeight: 2,
            productionAdamantiteWeight: 1,
            productionExtWeight_common: 1,
            productionExtWeight_uncommon: 1,
            productionExtWeight_rare: 1,
            productionFoundryWeighting: "demanded",
            productionCraftsmen: "nocraft",
            productionSmelting: "required",
            productionSmeltingIridium: 0.5,
            productionFactoryMinIngredients: 0,
            replicatorResource: 'Stone',
            replicatorAssignGovernorTask: true
        }

        // Foundry
        const setFoundryProduct = (item, autoCraftEnabled, crafterEnabled, craftWeighting, craftPreserve) => {
            let id = resources[item].id;
            def['craft' + id] = autoCraftEnabled;
            def['job_' + id] = crafterEnabled;
            def['foundry_w_' + id] = craftWeighting;
            def['foundry_p_' + id] = craftPreserve;
        };
        setFoundryProduct("Plywood", true, true, 1, 0);
        setFoundryProduct("Brick", true, true, 1, 0);
        setFoundryProduct("Wrought_Iron", true, true, 1, 0);
        setFoundryProduct("Sheet_Metal", true, true, 2, 0);
        setFoundryProduct("Mythril", true, true, 3, 0);
        setFoundryProduct("Aerogel", true, true, 3, 0);
        setFoundryProduct("Nanoweave", true, true, 10, 0);
        setFoundryProduct("Scarletite", true, true, 1, 0);
        setFoundryProduct("Quantium", true, true, 1, 0);

        // Smelter
        Object.values(SmelterManager.Fuels).forEach((fuel, i) => {
            def["smelter_fuel_p_" + fuel.id] = i; // priority
        });

        // Factory
        const setFactoryProduct = (item, enabled, weighting, priority) => {
            let id = FactoryManager.Productions[item].resource.id;
            def['production_' + id] = enabled;
            def['production_w_' + id] = weighting;
            def['production_p_' + id] = priority;
        };
        setFactoryProduct("LuxuryGoods", true, 1, 2);
        setFactoryProduct("Furs", true, 1, 1);
        setFactoryProduct("Alloy", true, 1, 3);
        setFactoryProduct("Polymer", true, 1, 3);
        setFactoryProduct("NanoTube", true, 4, 3);
        setFactoryProduct("Stanene", true, 4, 3);

        // Mining Droids
        const setDroidProduct = (item, weighting, priority) => {
            let id = DroidManager.Productions[item].resource.id;
            def['droid_w_' + id] = weighting;
            def['droid_pr_' + id] = priority;
        };
        setDroidProduct("Adamantite", 15, 1);
        setDroidProduct("Aluminium", 1, 1);
        setDroidProduct("Uranium", 5, -1);
        setDroidProduct("Coal", 5, -1);

        // Matter Replicator
        const setReplicatorProduct = (item, enabled, weighting, priority) => {
            let id = ReplicatorManager.Productions[item].id;
            def['replicator_' + id] = enabled;
            def['replicator_w_' + id] = weighting;
            def['replicator_p_' + id] = priority;
        };
        Object.values(ReplicatorManager.Productions).forEach(production => setReplicatorProduct(production.id, true, 1, 1));

        applySettings(def, reset);
    }

    function resetTriggerSettings(reset) {
        let def = {
            autoTrigger: false
        }

        // Add default triggers only on reset, or first run, but not on casual update
        if (reset || !settingsRaw.hasOwnProperty("autoTrigger")) {
            TriggerManager.priorityList = [];
            TriggerManager.AddTrigger("built", "space-moon_mission", 1, "build", "space-moon_base", 1);
            TriggerManager.AddTrigger("built", "space-moon_base", 1, "build", "space-iridium_mine", 1);
            TriggerManager.AddTrigger("built", "space-moon_base", 1, "build", "space-helium_mine", 1);
            settingsRaw.triggers = JSON.parse(JSON.stringify(TriggerManager.priorityList));
        }
        applySettings(def, reset);
    }

    function resetLoggingSettings(reset) {
        let def = {
            hellTurnOffLogMessages: true,
            logFilter: "",
            logEnabled: true,
        }
        Object.keys(GameLog.Types).forEach(id => def["log_" + id] = true);
        def["log_mercenary"] = false;
        def["log_multi_construction"] = false;
        def["log_prestige"] = false;
        def["log_prestige_format"] = "Reset: {resetType}, Species: {species}, Duration: {timeStamp} days";

        applySettings(def, reset);
    }

    function resetPlanetSettings(reset) {
        let def = {};
        biomeList.forEach(biome => def["biome_w_" + biome] = (planetBiomes.length - planetBiomes.indexOf(biome)) * 10);
        traitList.forEach(trait => def["trait_w_" + trait] = (planetTraits.length - planetTraits.indexOf(trait)) * 10);
        extraList.forEach(extra => def["extra_w_" + extra] = 0);
        def["extra_w_Achievement"] = 1000;

        applySettings(def, reset);
    }

    function resetFleetSettings(reset) {
        let def = {
            autoFleet: false,
            fleetOuterCrew: 30,
            fleetOuterShips: "custom",
            fleetExploreTau: true,
            fleetMaxCover: true,
            fleetEmbassyKnowledge: 6000000,
            fleetAlienGiftKnowledge: 6500000,
            fleetAlien2Knowledge: 8500000,
            fleetAlien2Loses: "none",
            fleetChthonianLoses: "low",

            // Default combat ship
            fleet_outer_class: 'destroyer',
            fleet_outer_armor: 'neutronium',
            fleet_outer_weapon: 'plasma',
            fleet_outer_engine: 'ion',
            fleet_outer_power: 'fission',
            fleet_outer_sensor: 'lidar',

            // Default scout ship
            fleet_scout_class: 'corvette',
            fleet_scout_armor: 'neutronium',
            fleet_scout_weapon: 'plasma',
            fleet_scout_engine: 'tie',
            fleet_scout_power: 'fusion',
            fleet_scout_sensor: 'quantum',

            // Default andromeda regions priority
            fleet_pr_gxy_stargate: 0,
            fleet_pr_gxy_alien2: 1,
            fleet_pr_gxy_alien1: 2,
            fleet_pr_gxy_chthonian: 3,
            fleet_pr_gxy_gateway: 4,
            fleet_pr_gxy_gorddon: 5,
        }

        const setOuterRegion = (id, weighting, protect, scouts) => {
            def['fleet_outer_pr_' + id] = weighting;
            def['fleet_outer_def_' + id] = protect;
            def['fleet_outer_sc_' + id] = scouts;
        };
        setOuterRegion("spc_moon", 1, 0.9, 0); // Iridium
        setOuterRegion("spc_red", 3, 0.9, 0); // Titanium
        setOuterRegion("spc_gas", 0, 0.9, 0); // Helium
        setOuterRegion("spc_gas_moon", 0, 0.9, 0); // Oil
        setOuterRegion("spc_belt", 1, 0.9, 0); // Iridium
        setOuterRegion("spc_titan", 5, 0.9, 1); // Adamantite
        setOuterRegion("spc_enceladus", 3, 0.9, 1); // Quantium
        setOuterRegion("spc_triton", 10, 0.95, 2); // Encrypted data
        setOuterRegion("spc_kuiper", 5, 0.9, 2); // Orichalcum
        setOuterRegion("spc_eris", 100, 0.01, 1); // Encrypted data

        applySettings(def, reset);
    }

    function resetMechSettings(reset) {
        let def = {
            autoMech: false,
            mechScrap: "mixed",
            mechScrapEfficiency: 1.5,
            mechCollectorValue: 0.5,
            mechBuild: "random",
            mechSize: "titan",
            mechSizeGravity: "auto",
            mechFillBay: true,
            mechScouts: 0.05,
            mechScoutsRebuild: false,
            mechMinSupply: 1000,
            mechMaxCollectors: 0.5,
            mechInfernalCollector: true,
            mechSpecial: "prefered",
            mechSaveSupplyRatio: 1,
            buildingMechsFirst: true,
            mechBaysFirst: true,
            mechWaygatePotential: 0.4,
        }

        applySettings(def, reset);
    }

    function resetEjectorSettings(reset) {
        if (game.global.race.universe === "magic") {
            EjectManager.priorityList = Object.values(resources)
              .filter(r => EjectManager.isConsumable(r))
              .sort((a, b) => b.atomicMass - a.atomicMass);
        } else {
            EjectManager.priorityList = Object.values(resources)
              .filter(r => EjectManager.isConsumable(r) && r !== resources.Elerium && r !== resources.Infernite)
              .sort((a, b) => b.atomicMass - a.atomicMass);
            EjectManager.priorityList.unshift(resources.Infernite);
            EjectManager.priorityList.unshift(resources.Elerium);
        }

        SupplyManager.priorityList = Object.values(resources)
          .filter(r => SupplyManager.isConsumable(r))
          .sort((a, b) => SupplyManager.supplyIn(b.id) - SupplyManager.supplyIn(a.id));

        NaniteManager.priorityList = Object.values(resources)
          .filter(r => NaniteManager.isConsumable(r))
          .sort((a, b) => b.atomicMass - a.atomicMass);

        let def = {
            autoEject: false,
            autoSupply: false,
            autoNanite: false,
            ejectMode: "cap",
            supplyMode: "mixed",
            naniteMode: "full",
            prestigeWhiteholeStabiliseMass: true,
        }

        for (let resource of EjectManager.priorityList) {
            def['res_eject' + resource.id] = resource.is.tradable ?? false;
        }
        for (let resource of SupplyManager.priorityList) {
            def['res_supply' + resource.id] = resource.is.tradable ?? false;
        }
        for (let resource of NaniteManager.priorityList) {
            def['res_nanite' + resource.id] = resource.is.tradable ?? false;
        }

        def['res_eject' + resources.Elerium.id] = true;
        def['res_eject' + resources.Infernite.id] = true;

        applySettings(def, reset);
    }

    function updateStateFromSettings() {
        TriggerManager.priorityList = [];
        settingsRaw.triggers.forEach(trigger => TriggerManager.AddTriggerFromSetting(trigger));
    }

    function updateSettingsFromState() {
        settingsRaw.triggers = JSON.parse(JSON.stringify(TriggerManager.priorityList));

        localStorage.setItem('settings', JSON.stringify(settingsRaw));
    }

    function applySettings(def, reset) {
        if (reset) {
            // There's no default overrides, just wipe them all on reset
            for (let key in def) {
                delete settingsRaw.overrides[key];
            }
            Object.assign(settingsRaw, def);
        } else {
            for (let key in def) {
                if (!settingsRaw.hasOwnProperty(key)) {
                    settingsRaw[key] = def[key];
                } else {
                    // Validate settings types, and fix if needed
                    if (typeof settingsRaw[key] === "string" && typeof def[key] === "number") {
                        settingsRaw[key] = Number(settingsRaw[key]);
                    }
                    if (typeof settingsRaw[key] === "number" && typeof def[key] === "string") {
                        settingsRaw[key] = String(settingsRaw[key]);
                    }
                }
            }
        }
    }

    function updateStandAloneSettings() {
        let def = {
            scriptName: "TMVictor",
            overrides: {},
            triggers: [],
        }
        settingsSections.forEach(id => def[id + "SettingsCollapsed"] = true);
        applySettings(def, false); // For non-overridable settings only

        // Pre-default migrate
        if (settingsRaw.hasOwnProperty("masterScriptToggle")) {
            if (!settingsRaw.hasOwnProperty("autoPrestige")) {
                settingsRaw.autoPrestige = true;
                ["job_b1_farmer", "job_b2_farmer", "job_b3_farmer", "job_b1_hunter", "job_b2_hunter", "job_b3_hunter"]
                  .forEach(id => delete settingsRaw[id]);
            }
            if (!settingsRaw.hasOwnProperty("buildingsLimitPowered")) {
                settingsRaw.buildingsLimitPowered = false;
            }
        }

        // Apply default settings
        resetEvolutionSettings(false);
        resetWarSettings(false);
        resetHellSettings(false);
        resetMechSettings(false);
        resetFleetSettings(false);
        resetGovernmentSettings(false);
        resetBuildingSettings(false);
        resetWeightingSettings(false);
        resetMarketSettings(false);
        resetResearchSettings(false);
        resetProjectSettings(false);
        resetJobSettings(false);
        resetMagicSettings(false);
        resetProductionSettings(false);
        resetStorageSettings(false);
        resetGeneralSettings(false);
        resetPrestigeSettings(false);
        resetEjectorSettings(false);
        resetPlanetSettings(false);
        resetLoggingSettings(false);
        resetTriggerSettings(false);
        resetMinorTraitSettings(false);
        resetMutableTraitSettings(false);

        // Validate overrides types, and fix if needed
        for (let key in settingsRaw.overrides) {
            for (let i = 0; i < settingsRaw.overrides[key].length; i++) {
                let override = settingsRaw.overrides[key][i];
                if (typeof settingsRaw[key] === "string" && typeof override.ret === "number") {
                    override.ret = String(override.ret);
                }
                if (typeof settingsRaw[key] === "number" && typeof override.ret === "string") {
                    override.ret = Number(override.ret);
                }
            }
        }
        // Migrate pre-overrides settings
        settingsRaw.triggers.forEach(t => {
            if (techIds["tech-" + t.actionId]) { t.actionId = "tech-" + t.actionId; }
            if (techIds["tech-" + t.requirementId]) { t.requirementId = "tech-" + t.requirementId; }
        });
        if (settingsRaw.hasOwnProperty("productionPrioritizeDemanded")) { // Replace checkbox with list
            settingsRaw.productionFoundryWeighting = settingsRaw.productionPrioritizeDemanded ? "demanded" : "none";
        }
        settingsRaw.challenge_plasmid = settingsRaw.challenge_mastery || settingsRaw.challenge_plasmid; // Merge challenge settings
        if (settingsRaw.hasOwnProperty("res_trade_buy_mtr_Food")) { // Reset default market settings for pre-rework configs
            MarketManager.priorityList.forEach(res => settingsRaw['res_trade_buy_' + res.id] = true);
        }
        if (settingsRaw.hasOwnProperty("arpa")) { // Move arpa from object to strings
            Object.entries(settingsRaw.arpa).forEach(([id, enabled]) => settingsRaw["arpa_" + id] = enabled);
        }
        // Remove deprecated pre-overrides settings
        ["buildingWeightingTriggerConflict", "researchAlienGift", "arpaBuildIfStorageFullCraftableMin", "arpaBuildIfStorageFullResourceMaxPercent", "arpaBuildIfStorageFull", "productionMoneyIfOnly", "autoAchievements", "autoChallenge", "autoMAD", "autoSpace", "autoSeeder", "foreignSpyManage", "foreignHireMercCostLowerThan", "userResearchUnification", "btl_Ambush", "btl_max_Ambush", "btl_Raid", "btl_max_Raid", "btl_Pillage", "btl_max_Pillage", "btl_Assault", "btl_max_Assault", "btl_Siege", "btl_max_Siege", "smelter_fuel_Oil", "smelter_fuel_Coal", "smelter_fuel_Lumber", "planetSettingsCollapser", "buildingManageSpire", "hellHandleAttractors", "researchFilter", "challenge_mastery", "hellCountGems", "productionPrioritizeDemanded", "fleetChthonianPower", "productionWaitMana", "arpa", "autoLogging"]
          .forEach(id => delete settingsRaw[id]);
        ["foreignAttack", "foreignOccupy", "foreignSpy", "foreignSpyMax", "foreignSpyOp"]
          .forEach(id => [0, 1, 2].forEach(index => delete settingsRaw[id + index]));
        ["res_storage_w_", "res_trade_buy_mtr_", "res_trade_sell_mps_"]
          .forEach(id => Object.values(resources).forEach(resource => delete settingsRaw[id + resource.id]));
        Object.values(projects).forEach(project => delete settingsRaw['arpa_ignore_money_' + project.id]);
        Object.values(buildings).filter(building => !building.isSwitchable()).forEach(building => delete settingsRaw['bld_s_' + building._vueBinding]);
        // Migrate post-overrides settings
        migrateSetting("prestigeWhiteholeEjectEnabled", "autoEject", (v) => v);
        migrateSetting("mechSaveSupply", "mechSaveSupplyRatio", (v) => v ? 1 : 0);
        migrateSetting("foreignProtectSoldiers", "foreignProtect", (v) => v ? "always" : "never");
        migrateSetting("prestigeWhiteholeEjectExcess", "ejectMode", (v) => v ? "mixed" : "cap");
        migrateSetting("hellHandlePatrolCount", "autoHell", (v) => v, true);
        migrateSetting("unificationRequest", "prioritizeUnify", (v) => v ? "savereq" : "ignore");
        migrateSetting("queueRequest", "prioritizeQueue", (v) => v ? "savereq" : "ignore");
        migrateSetting("triggerRequest", "prioritizeTriggers", (v) => v ? "savereq" : "ignore");
        migrateSetting("govManage", "autoGovernment", (v) => v);
        migrateSetting("storagePrioritizedOnly", "storageAssignPart", (v) => !v);
        migrateSetting("fleetScanEris", "fleet_outer_pr_spc_eris", (v) => v ? 100 : 0);
        migrateSetting("jobDisableCraftsmans", "productionCraftsmen", (v) => v ? "nocraft" : "always");
        migrateSetting("activeTriggerUI", "activeTargetsUI", (v) => v);
        migrateSetting("autoAssembleGene", "autoGenetics", (v) => v);
        // Migrate setting as override, in case if someone actualy use it
        if (settingsRaw.hasOwnProperty("genesAssembleGeneAlways")) {
            if (settingsRaw.overrides.genesAssembleGeneAlways) {
                settingsRaw.overrides.geneticsAssemble = settingsRaw.overrides.genesAssembleGeneAlways.concat(settingsRaw.overrides.geneticsAssemble ?? []);
            }
            if (!settingsRaw.genesAssembleGeneAlways) {
                settingsRaw.overrides.geneticsAssemble = settingsRaw.overrides.geneticsAssemble ?? [];
                settingsRaw.overrides.geneticsAssemble.push({"type1":"ResearchComplete","arg1":"tech-dna_sequencer","type2":"Boolean","arg2":true,"cmp":"==","ret":"none"});
            }
        }
        if (settingsRaw.hasOwnProperty("prestigeWhiteholeEjectAllCount") && settingsRaw.prestigeWhiteholeEjectAllCount <= 20) {
            settingsRaw.overrides.ejectMode = settingsRaw.overrides.ejectMode ?? [];
            settingsRaw.overrides.ejectMode.push({"type1":"BuildingCount","arg1":"interstellar-mass_ejector","type2":"Number","arg2":settingsRaw.prestigeWhiteholeEjectAllCount,"cmp":">=","ret":"all"});
        }
        if (settingsRaw.hasOwnProperty("prestigeAscensionSkipCustom") && !settings.prestigeAscensionSkipCustom) {
            settingsRaw.overrides.autoPrestige = settingsRaw.overrides.autoPrestige ?? [];
            settingsRaw.overrides.autoPrestige.push({"type1":"ResetType","arg1":"ascension","type2":"Boolean","arg2":true,"cmp":"==","ret":false});
        }
        // Garbage collection
        Object.values(crafter).forEach(job => { delete settingsRaw['job_p_' + job._originalId], delete settingsRaw['job_b1_' + job._originalId], delete settingsRaw['job_b2_' + job._originalId], delete settingsRaw['job_b3_' + job._originalId] });
        // Remove deprecated post-overrides settings
        ["res_containers_m_", "res_crates_m_"].forEach(id => Object.values(resources)
          .forEach(res => { delete settingsRaw[id + res.id], delete settingsRaw.overrides[id + res.id] }));
        ["prestigeWhiteholeEjectAllCount", "prestigeWhiteholeDecayRate", "genesAssembleGeneAlways", "buildingsConflictQueue", "buildingsConflictRQueue", "buildingsConflictPQueue", "fleet_outer_pr_spc_hell", "fleet_outer_pr_spc_dwarf", "prestigeEnabledBarracks", "bld_s2_city-garrison", "prestigeAscensionSkipCustom", "prestigeBioseedGECK", "tickTimeout", "minorTraitSettingsCollapsed", "fleetOuterMinSyndicate", "smelter_fuel_p_Star"]
          .forEach(id => { delete settingsRaw[id], delete settingsRaw.overrides[id] });
    }

    function migrateSetting(oldSetting, newSetting, mapCb, keepOldValue) {
        if (settingsRaw.hasOwnProperty(oldSetting)) {
            if (!keepOldValue) {
                settingsRaw[newSetting] = mapCb(settingsRaw[oldSetting]);
            }
            delete settingsRaw[oldSetting];
        }
        if (settingsRaw.overrides.hasOwnProperty(oldSetting)) {
            settingsRaw.overrides[oldSetting].forEach(o => o.ret = mapCb(o.ret));
            settingsRaw.overrides[newSetting] = (settingsRaw.overrides[newSetting] ?? []).concat(settingsRaw.overrides[oldSetting]);
            delete settingsRaw.overrides[oldSetting];
        }
    }

    function getStarLevel(context) {
        let a_level = 1;
        if (context.challenge_plasmid) { a_level++; }
        if (context.challenge_trade) { a_level++; }
        if (context.challenge_craft) { a_level++; }
        if (context.challenge_crispr) { a_level++; }
        return a_level;
    }

    function getAchievementStar(id, universe) {
        return game.global.stats.achieve[id]?.[poly.universeAffix(universe)] ?? 0;
    }

    function isAchievementUnlocked(id, level, universe) {
        return getAchievementStar(id, universe) >= level;
    }

    function loadQueuedSettings() {
        if (settings.evolutionQueueEnabled && settingsRaw.evolutionQueue.length > 0) {
            state.evolutionAttempts++;
            let queuedEvolution = settingsRaw.evolutionQueue.shift();
            for (let [settingName, settingValue] of Object.entries(queuedEvolution)) {
                if (typeof settingsRaw[settingName] === typeof settingValue) {
                    settingsRaw[settingName] = settingValue;
                } else {
                    GameLog.logDanger("special", `Type mismatch during loading queued settings: settingsRaw.${settingName} type: ${typeof settingsRaw[settingName]}, value: ${settingsRaw[settingName]}; queuedEvolution.${settingName} type: ${typeof settingValue}, value: ${settingValue};`, ['events', 'major_events']);
                }
            }
            updateOverrides();
            if (settings.evolutionQueueRepeat) {
                settingsRaw.evolutionQueue.push(queuedEvolution);
            }
            updateStandAloneSettings();
            updateStateFromSettings();
            updateSettingsFromState();
            if (settings.showSettings) {
                removeScriptSettings();
                buildScriptSettings();
            }
        }
    }

    function autoEvolution() {
        if (game.global.race.species !== "protoplasm") {
            return;
        }

        autoUniverseSelection();
        autoPlanetSelection();

        // Wait for universe and planet, we don't want to run auto achievement until we'll land somewhere
        if (game.global.race.universe === 'bigbang' || (game.global.race.seeded && !game.global.race['chose'])) {
            return;
        }

        if (state.evolutionTarget === null) {
            loadQueuedSettings();

            // Try to pick race for achievement first
            if (settings.userEvolutionTarget === "auto") {
                let raceByWeighting = Object.values(races).sort((a, b) => b.getWeighting() - a.getWeighting());

                if (game.global.stats.achieve['mass_extinction']) {
                    // With Mass Extinction we can pick any race, go for best one
                    state.evolutionTarget = raceByWeighting[0];
                } else {
                    // Otherwise go for genus having most weight
                    let genusList = Object.values(races).map(r => r.genus).filter((v, i, a) => a.indexOf(v) === i);
                    let genusWeights = genusList.map(g => [g, Object.values(races).filter(r => r.genus === g).map(r => r.getWeighting()).reduce((sum, next) => sum + next)]);
                    let bestGenus = genusWeights.sort((a, b) => b[1] - a[1])[0][0];
                    state.evolutionTarget = raceByWeighting.find(r => r.genus === bestGenus);
                }
            }

            // Auto Achievements disabled, checking user specified race
            if (settings.userEvolutionTarget !== "auto") {
                let userRace = races[settings.userEvolutionTarget];
                if (userRace && userRace.getHabitability() > 0){
                    // Race specified, and condition is met
                    state.evolutionTarget = userRace
                }
            }

            // Try to pull next race from queue
            if (state.evolutionTarget === null && settings.evolutionQueueEnabled && settingsRaw.evolutionQueue.length > 0 && (!settings.evolutionQueueRepeat || state.evolutionAttempts < settingsRaw.evolutionQueue.length)) {
                return;
            }

            // Still no target. Fallback to custom, or ent.
            if (state.evolutionTarget === null) {
                state.evolutionTarget = races.custom.getHabitability() > 0 ? races.custom : races.entish;
            }
            GameLog.logSuccess("special", `Attempting evolution of ${state.evolutionTarget.name}.`, ['progress']);
        }

        // Apply challenges
        for (let i = 0; i < challenges.length; i++) {
            if (settings["challenge_" + challenges[i][0].id]) {
                for (let j = 0; j < challenges[i].length; j++) {
                    let {id, trait} = challenges[i][j];
                    if (game.global.race[trait] !== 1 && evolutions[id].click() && (id === "junker" || id === "sludge")) {
                        return; // Give game time to update state after activating junker
                    }
                }
            }
        }

        // Calculate the maximum RNA and DNA required to evolve and don't build more than that
        let maxRNA = 0;
        let maxDNA = 0;

        for (let i = 0; i < state.evolutionTarget.evolutionTree.length; i++) {
            let evolution = state.evolutionTarget.evolutionTree[i];
            let costs = poly.adjustCosts(evolution.definition);

            maxRNA = Math.max(maxRNA, Number(costs["RNA"]?.() ?? 0));
            maxDNA = Math.max(maxDNA, Number(costs["DNA"]?.() ?? 0));
        }

        // Gather some resources and evolve
        let DNAForEvolution = Math.min(maxDNA - resources.DNA.currentQuantity, resources.DNA.maxQuantity - resources.DNA.currentQuantity, resources.RNA.maxQuantity / 2);
        let RNAForDNA = Math.min(DNAForEvolution * 2 - resources.RNA.currentQuantity, resources.RNA.maxQuantity - resources.RNA.currentQuantity);
        let RNARemaining = resources.RNA.currentQuantity + RNAForDNA - DNAForEvolution * 2;
        let RNAForEvolution = Math.min(maxRNA - RNARemaining, resources.RNA.maxQuantity - RNARemaining);

        let rna = game.actions.evolution.rna;
        let dna = game.actions.evolution.dna;
        for (let i = 0; i < RNAForDNA; i++) { rna.action(); }
        for (let i = 0; i < DNAForEvolution; i++) { dna.action(); }
        for (let i = 0; i < RNAForEvolution; i++) { rna.action(); }

        resources.RNA.currentQuantity = RNARemaining + RNAForEvolution;
        resources.DNA.currentQuantity = resources.DNA.currentQuantity + DNAForEvolution;

        // Lets go for our targeted evolution
        for (let i = 0; i < state.evolutionTarget.evolutionTree.length; i++) {
            let action = state.evolutionTarget.evolutionTree[i];
            if (action.isUnlocked()) {
                // Don't click challenges which already active
                let challenge = challenges.flat().find(c => c.id === action.id);
                if (challenge && game.global.race[challenge.trait]) {
                    continue;
                }
                if (action.click()) {
                    // If we successfully click the action then return to give the ui some time to refresh
                    return;
                } else {
                    // Our path is unlocked but we can't click it yet
                    break;
                }
            }
        }

        if (evolutions.mitochondria.count < 1 || resources.RNA.maxQuantity < maxRNA || resources.DNA.maxQuantity < maxDNA) {
            evolutions.mitochondria.click();
        }
        if (evolutions.eukaryotic_cell.count < 1 || resources.DNA.maxQuantity < maxDNA) {
            evolutions.eukaryotic_cell.click();
        }
        if (resources.RNA.maxQuantity < maxRNA) {
            evolutions.membrane.click();
        }
        if (evolutions.nucleus.count < 10) {
            evolutions.nucleus.click();
        }
        if (evolutions.organelles.count < 10) {
            evolutions.organelles.click();
        }

        const userImitateRace = Object.values(imitations).find(race => {
            return race.id === `s-${settings.imitateRace}`
        });

        if (game.global.race.evoFinalMenu) {
            if (userImitateRace) {
                const selectImitateRace = userImitateRace.click();

                if (!selectImitateRace) {
                    GameLog.logDanger("special", `${settings.imitateRace} not avaialble for imitation. Please select an available race.`, ['progress', 'achievements']);
                }
            } else {
                GameLog.logDanger("special", `No race selected for imitation. Please select an available race to continue.`, ['progress', 'achievements']);
            }
        }
    }

    function autoUniverseSelection() {
        if (!game.global.race['bigbang']) { return; }
        if (game.global.race.universe !== 'bigbang') { return; }
        if (settings.userUniverseTargetName === 'none') { return; }

        let action = document.getElementById(`uni-${settings.userUniverseTargetName}`);

        if (action !== null) {
            action.children[0].click();
        }
    }

    // function setPlanet from actions.js
    // Produces same set of planets, accurate for v1.0.29
    function generatePlanets() {
        let seed = game.global.race.seed;
        let seededRandom = function(min = 0, max = 1) {
            seed = (seed * 9301 + 49297) % 233280;
            let rnd = seed / 233280;
            return min + rnd * (max - min);
        }

        let avail = [];
        if (game.global.stats.achieve.lamentis?.l >= 4){
            for (let u of universes) {
                let uafx = poly.universeAffix(u);
                if (game.global.custom.planet[uafx]?.s){
                    avail.push(`${uafx}:s`);
                }
            }
        }


        let biomes = ['grassland', 'oceanic', 'forest', 'desert', 'volcanic', 'tundra', game.global.race.universe === 'evil' ? 'eden' : 'hellscape'];
        let subbiomes = ['savanna', 'swamp', ['taiga', 'swamp'], 'ashland', 'ashland', 'taiga'];
        let traits = ['toxic', 'mellow', 'rage', 'stormy', 'ozone', 'magnetic', 'trashed', 'elliptical', 'flare', 'dense', 'unstable', 'permafrost', 'retrograde'];
        let geologys = ['Copper', 'Iron', 'Aluminium', 'Coal', 'Oil', 'Titanium', 'Uranium'];
        if (game.global.stats.achieve['whitehole']) {
            geologys.push('Iridium');
        }

        let planets = [];
        let hell = false;
        let maxPlanets = Math.max(1, game.global.race.probes);
        for (let i = 0; i < maxPlanets; i++){
            let planet = {biome: 'grassland', traits: [], orbit: 365, geology: {}};

            if (avail.length > 0 && Math.floor(seededRandom(0,10)) === 0){
                let custom = avail[Math.floor(seededRandom(0,avail.length))];
                avail.splice(avail.indexOf(custom), 1);
                let target = custom.split(':');
                let p = game.global.custom.planet[target[0]][target[1]];

                planet.biome = p.biome;
                planet.traits = p.traitlist;
                planet.orbit = p.orbit;
                planet.geology = p.geology;
            } else {
                let max_bound = !hell && game.global.stats.portals >= 1 ? 7 : 6;

                let subbiome = Math.floor(seededRandom(0,3)) === 0 ? true : false;
                let idx = Math.floor(seededRandom(0, max_bound));

                if (subbiome && isAchievementUnlocked("biome_" + biomes[idx], 1) && idx < subbiomes.length) {
                    let sub = subbiomes[idx];
                    if (sub instanceof Array) {
                        planet.biome = sub[Math.floor(seededRandom(0, sub.length))];
                    } else {
                        planet.biome = sub;
                    }
                } else {
                    planet.biome = biomes[idx];
                }

                planet.traits = [];
                for (let i = 0; i < 2; i++){
                    let idx = Math.floor(seededRandom(0, 18 + (9 * i)));
                    if (traits[idx] === 'permafrost' && ['volcanic','ashland','hellscape'].includes(planet.biome)) {
                        continue;
                    }
                    if (idx < traits.length && !planet.traits.includes(traits[idx])) {
                        planet.traits.push(traits[idx]);
                    }
                }
                planet.traits.sort();
                if (planet.traits.length === 0) {
                    planet.traits.push('none');
                }

                let max = Math.floor(seededRandom(0,3));
                let top = planet.biome === 'eden' ? 35 : 30;
                if (game.global.stats.achieve['whitehole']){
                    max += game.global.stats.achieve['whitehole'].l;
                    top += game.global.stats.achieve['whitehole'].l * 5;
                }

                for (let i = 0; i < max; i++){
                    let index = Math.floor(seededRandom(0, 10));
                    if (geologys[index]) {
                        planet.geology[geologys[index]] = ((Math.floor(seededRandom(0, top)) - 10) / 100);
                    }
                }

                if (planet.biome === 'hellscape') {
                    planet.orbit = 666;
                    hell = true;
                } else if (planet.biome === 'eden') {
                    planet.orbit = 777;
                    hell = true;
                } else {
                    planet.orbit = Math.floor(seededRandom(200, planet.traits.includes('elliptical') ? 800 : 600));
                }
            }

            let id = planet.biome + Math.floor(seededRandom(0,10000));
            planet.id = id.charAt(0).toUpperCase() + id.slice(1);

            planets.push(planet);
        }
        return planets;
    }

    function autoPlanetSelection() {
        if (game.global.race.universe === 'bigbang') { return; }
        if (!game.global.race.seeded || game.global.race['chose']) { return; }
        if (settings.userPlanetTargetName === 'none') { return; }

        let planets = generatePlanets();

        // Let's try to calculate how many achievements we can get here
        let alevel = getStarLevel(settings);
        for (let i = 0; i < planets.length; i++){
            let planet = planets[i];
            planet.achieve = 0;

            if (!isAchievementUnlocked("biome_" + planet.biome, alevel)) {
                planet.achieve++;
            }
            for (let trait of planet.traits) {
                if (trait !== "none" && !isAchievementUnlocked("atmo_" + trait, alevel)) {
                    planet.achieve++;
                }
            }
            if (planetBiomeGenus[planet.biome]) {
                for (let id in races) {
                    if (races[id].genus === planetBiomeGenus[planet.biome] && !isAchievementUnlocked("extinct_" + id, alevel)) {
                        planet.achieve++;
                    }
                }
                // All races have same genus, no need to check both
                if (!isAchievementUnlocked("genus_" + planetBiomeGenus[planet.biome], alevel)) {
                    planet.achieve++;
                }
            }
            // TODO: Pick Oceanic for Madagascar Tree
        }

        // Now calculate weightings
        for (let i = 0; i < planets.length; i++){
            let planet = planets[i];
            planet.weighting = 0;

            planet.weighting += settings["biome_w_" + planet.biome];
            for (let trait of planet.traits) {
                planet.weighting += settings["trait_w_" + trait];
            }

            planet.weighting += planet.achieve * settings["extra_w_Achievement"];
            planet.weighting += planet.orbit * settings["extra_w_Orbit"];

            let numShow = game.global.stats.achieve['miners_dream'] ? game.global.stats.achieve['miners_dream'].l >= 4 ? game.global.stats.achieve['miners_dream'].l * 2 - 3 : game.global.stats.achieve['miners_dream'].l : 0;
            if (game.global.stats.achieve.lamentis?.l >= 0){ numShow++; }
            for (let id in planet.geology) {
                if (planet.geology[id] === 0) {
                    continue;
                }
                if (numShow-- > 0) {
                    planet.weighting += (planet.geology[id] / 0.01) * settings["extra_w_" + id];
                } else {
                    planet.weighting += (planet.geology[id] > 0 ? 1 : -1) * settings["extra_w_" + id];
                }
            }
        }

        if (settings.userPlanetTargetName === "weighting") {
            planets.sort((a, b) => b.weighting - a.weighting);
        }

        if (settings.userPlanetTargetName === "habitable") {
            planets.sort((a, b) => (planetBiomes.indexOf(a.biome) + planetTraits.indexOf(a.trait)) -
                                   (planetBiomes.indexOf(b.biome) + planetTraits.indexOf(b.trait)));
        }

        if (settings.userPlanetTargetName === "achieve") {
            planets.sort((a, b) => a.achieve !== b.achieve ? b.achieve - a.achieve :
                                   (planetBiomes.indexOf(a.biome) + planetTraits.indexOf(a.trait)) -
                                   (planetBiomes.indexOf(b.biome) + planetTraits.indexOf(b.trait)));
        }

        let selectedPlanet = document.getElementById(planets[0].id);
        if (selectedPlanet) {
            // We need a popper to avoid exception when gecking planet
            selectedPlanet.dispatchEvent(new MouseEvent("mouseover", {}));
            selectedPlanet.children[0].click();
        }
    }

    function autoCraft() {
        if (!resources.Population.isUnlocked()) { return; }
        if (game.global.race['no_craft']) { return; }

        craftLoop:
        for (let i = 0; i < foundryList.length; i++) {
            let craftable = foundryList[i];
            if (!craftable.isUnlocked() || !craftable.autoCraftEnabled) {
                continue;
            }

            let affordableAmount = Number.MAX_SAFE_INTEGER;
            for (let res in craftable.cost) {
                let resource = resources[res];
                let quantity = craftable.cost[res];

                affordableAmount = Math.min(affordableAmount, Math.ceil((resource.currentQuantity - (resource.maxQuantity * craftable.craftPreserve)) / quantity));

                if (craftable.isDemanded()) { // Craftable demanded, get as much as we can
                    let maxUse = (resource.currentQuantity < resource.maxQuantity * (craftable.craftPreserve + 0.05))
                      ? resource.currentQuantity : resource.spareQuantity;
                    affordableAmount = Math.min(affordableAmount, maxUse / quantity);
                } else if (resource.isDemanded() || (!resource.isCapped() && resource.usefulRatio < craftable.usefulRatio)) { // Don't use demanded resources
                    continue craftLoop;
                } else if (craftable.currentQuantity < craftable.storageRequired) { // Craftable is required, use all spare resources
                    affordableAmount = Math.min(affordableAmount, resource.spareQuantity / quantity);
                } else if (resource.currentQuantity >= resource.storageRequired || resource.isCapped()) { // Resource not required - consume income
                    affordableAmount = Math.min(affordableAmount, Math.ceil(resource.rateOfChange / ticksPerSecond() / quantity));
                } else { // Resource is required, and craftable not required. Don't craft anything.
                    continue craftLoop;
                }
            }
            affordableAmount = Math.floor(affordableAmount);
            if (affordableAmount >= 1) {
                craftable.tryCraftX(affordableAmount);
                for (let res in craftable.cost) {
                    resources[res].currentQuantity -= craftable.cost[res] * affordableAmount;
                }
            }
        }
    }

    function autoGovernment() {
        // Change government
        if (GovernmentManager.isEnabled()) {
            if (settings.govSpace !== "none" && haveTech("q_factory") && GovernmentManager.Types[settings.govSpace].isUnlocked()) {
                GovernmentManager.setGovernment(settings.govSpace);
            } else if (settings.govFinal !== "none" && GovernmentManager.Types[settings.govFinal].isUnlocked()) {
                GovernmentManager.setGovernment(settings.govFinal);
            } else if (settings.govInterim !== "none" && GovernmentManager.Types[settings.govInterim].isUnlocked()) {
                GovernmentManager.setGovernment(settings.govInterim);
            }
        }

        // Appoint governor
        if (haveTech("governor") && settings.govGovernor !== "none" && getGovernor() === "none") {
            let candidates = game.global.race.governor?.candidates ?? [];
            for (let i = 0; i < candidates.length; i++) {
                if (candidates[i].bg === settings.govGovernor) {
                    getVueById("candidates")?.appoint(i);
                    break;
                }
            }
        }
    }

    function autoMerc() {
        let m = WarManager;
        if (!m._garrisonVue || !m.isMercenaryUnlocked() || m.maxCityGarrison <= 0) {
            return;
        }

        let mercenaryCost = m.mercenaryCost;
        let mercenariesHired = 0;
        let mercenaryMax = m.maxSoldiers - settings.foreignHireMercDeadSoldiers;
        let maxCost = state.moneyMedian * settings.foreignHireMercCostLowerThanIncome;
        let minMoney = Math.max(resources.Money.maxQuantity * settings.foreignHireMercMoneyStoragePercent / 100, Math.min(resources.Money.maxQuantity - maxCost, (settings.storageAssignExtra ? resources.Money.storageRequired / 1.03 : resources.Money.storageRequired)));
        if (state.goal === "Reset") { // Get as much as possible before reset
            mercenaryMax = m.maxSoldiers;
            minMoney = 0;
            maxCost = Number.MAX_SAFE_INTEGER;
        }
        while (m.currentSoldiers < mercenaryMax && resources.Money.currentQuantity >= mercenaryCost &&
              (resources.Money.spareQuantity - mercenaryCost > minMoney || mercenaryCost < maxCost) &&
            m.hireMercenary()) {
            mercenariesHired++;
            mercenaryCost = m.mercenaryCost;
        }

        // Log the interaction
        if (mercenariesHired === 1) {
            GameLog.logSuccess("mercenary", `Hired a mercenary to join the garrison.`, ['combat']);
        } else if (mercenariesHired > 1) {
            GameLog.logSuccess("mercenary", `Hired ${mercenariesHired} mercenaries to join the garrison.`, ['combat']);
        }
    }

    function autoSpy() {
        let m = SpyManager;
        if (!m._foreignVue || haveTask("spyop") || !haveTech("spy")) {
            return;
        }

        // Have no excess money, nor ability to use spies
        if (!haveTech("spy", 2) && resources.Money.storageRatio < 0.9) {
            return;
        }

        // Train spies
        if (settings.foreignTrainSpy) {
            for (let foreign of m.foreignActive) {
                // Spy already in training, or can't be afforded, or foreign is under control
                if (m._foreignVue.spy_disabled(foreign.id) || foreign.gov.occ || foreign.gov.anx || foreign.gov.buy) {
                    continue;
                }

                let spiesRequired = settings.foreignSpyMax >= 0 ? settings.foreignSpyMax : Number.MAX_SAFE_INTEGER;
                if (spiesRequired < 1 && foreign.policy !== "Occupy" && foreign.policy !== "Ignore") {
                    spiesRequired = 1;
                }
                // We need 3 spies to purchase, but only if we have enough money cap to purchase
                if (spiesRequired < 3 && foreign.policy === "Purchase" && resources.Money.maxQuantity >= poly.govPrice(foreign.id)) {
                    spiesRequired = 3;
                }

                // We reached the max number of spies allowed
                if (foreign.gov.spy >= spiesRequired || (m.purchaseMoney > 0 && foreign.policy !== "Purchase" && foreign.gov.spy > 0)){
                    continue;
                }

                GameLog.logSuccess("spying", `Training a spy to send against ${getGovName(foreign.id)}.`, ['spy']);
                m._foreignVue.spy(foreign.id);
            }
        }

        // We can't use our spies yet
        if (!haveTech("spy", 2)) {
            return;
        }

        // Perform espionage
        for (let foreign of m.foreignActive) {
            // Spy is missing, busy, or have nosthing to do
            if (foreign.gov.spy < 1 || foreign.gov.sab !== 0 || foreign.policy === "None") {
                continue;
            }

            let espionageMission = null;
            if (foreign.policy === "Betrayal") {
                if (foreign.gov.mil <= 75 || foreign.gov.hstl <= 0) {
                    espionageMission = m.Types.Sabotage;
                } else {
                    espionageMission = m.Types.Influence;
                }
            } else if (foreign.policy === "Occupy") {
                espionageMission = m.Types.Sabotage;
            } else {
                espionageMission = m.Types[foreign.policy];
            }
            if (!espionageMission) {
                continue;
            }

            // Don't kill spies doing other things if we already can purchase
            if (m.purchaseMoney > 0 && m.purchaseForeigngs.includes(foreign.id) && espionageMission === m.Types.Purchase && foreign.gov.spy < 3 && !game.global.race['elusive']) {
                continue;
            }

            // Unoccupy power if it's controlled, but we want something different
            if ((foreign.gov.anx && foreign.policy !== "Annex") ||
                (foreign.gov.buy && foreign.policy !== "Purchase") ||
                (foreign.gov.occ && foreign.policy !== "Occupy")){
                WarManager.release(foreign.id);
                foreign.released = true;
            } else if (!foreign.gov.anx && !foreign.gov.buy && !foreign.gov.occ) {
                m.performEspionage(foreign.id, espionageMission.id, foreign !== m.foreignTarget);
            }
        }
    }

    function autoBattle() {
        let sm = SpyManager;
        let m = WarManager;
        if (!m._garrisonVue || !sm._foreignVue || m.maxCityGarrison <= 0 || state.goal === "Reset" || settings.foreignPacifist) {
            return;
        }


        // If we are not fully ready then return
        let healthyMin = settings.foreignAttackHealthySoldiersPercent / 100;
        let livingMin = (settings.foreignProtect === "auto" && m.wounded <= 0) ? 0
          : settings.foreignAttackLivingSoldiersPercent / 100;
        if ((m.wounded > (1 - healthyMin) * m.maxCityGarrison) ||
            (m.currentCityGarrison < livingMin * m.maxCityGarrison)) {
            return;
        }

        let minAdv = settings.foreignMinAdvantage;
        let maxAdv = settings.foreignMaxAdvantage;

        // Calculating safe size of battalions, if needed
        let protectSoldiers = settings.foreignProtect === "always" ? true : false;
        if (settings.foreignProtect === "auto") {
            let garrison = game.global.civic.garrison;
            let timeToRecruit = (m.deadSoldiers * 100 - garrison.progress) / (garrison.rate * 4) // Recruitmen ticks in short loop - 4 times per second
            let timeToHeal = m.wounded / getHealingRate() * 5; // Heal tick in long loop - once per 5 seconds
            protectSoldiers = timeToRecruit > timeToHeal;
        }
        if (protectSoldiers) {
            minAdv = Math.max(minAdv, 80);
            maxAdv = Math.max(maxAdv, minAdv)
        }

        // TODO: Configurable max
        let maxBattalion = new Array(5).fill(m.availableGarrison);
        let requiredBattalion = m.maxCityGarrison;
        if (protectSoldiers) {
            let armor = (traitVal('scales', 0) + (game.global.tech.armor ?? 0)) / traitVal('armored', 0, '-') - traitVal('frail', 0);
            let protectedBattalion = [5, 10, 25, 50, 999].map((cap, tactic) => (armor >= (cap * traitVal('high_pop', 0, 1)) ? Number.MAX_SAFE_INTEGER : ((5 - tactic) * (armor + (game.global.city.ptrait.includes('rage') ? 1 : 2)) - 1)));
            maxBattalion = protectedBattalion.map(soldiers => Math.min(soldiers, m.availableGarrison));
            requiredBattalion = 0;
        }
        maxBattalion[4] = Math.min(maxBattalion[4], settings.foreignMaxSiegeBattalion);

        let requiredTactic = 0;

        // Check if there's something that we want and can occupy, and switch to that target if found
        let currentTarget = sm.foreignTarget;
        for (let foreign of sm.foreignActive) {
            if (foreign.policy === "Occupy" && !foreign.gov.occ) {
                let soldiersMin = m.getSoldiersForAdvantage(settings.foreignMinAdvantage, 4, foreign.id);
                if (soldiersMin <= (settings.autoHell && m._hellVue ? m.maxSoldiers - m.hellReservedSoldiers : m.maxCityGarrison)) {
                    currentTarget = foreign;
                    requiredBattalion = Math.max(soldiersMin, Math.min(m.availableGarrison, m.getSoldiersForAdvantage(settings.foreignMaxAdvantage, 4, foreign.id) - 1));
                    requiredTactic = 4;
                    if (m.availableGarrison < (requiredBattalion / 2 + getOccCosts()) && m.availableGarrison < m.maxCityGarrison) {
                        return; // Wait for more soldiers
                    } else {
                        break;
                    }
                }
            }
        }
        // Nothing to attack
        if (!currentTarget) {
            return;
        }

        if (requiredTactic !== 4) {
            // If we don't need to occupy our target, then let's find best tactic for plundering
            // Never try siege if it can mess with unification
            for (let i = !settings.foreignUnification || settings.foreignOccupyLast ? 4 : 3; i >= 0; i--) {
                let soldiersMin = m.getSoldiersForAdvantage(minAdv, i, currentTarget.id);
                if (soldiersMin <= maxBattalion[i]) {
                    requiredBattalion = Math.max(soldiersMin, Math.min(maxBattalion[i], m.availableGarrison, m.getSoldiersForAdvantage(maxAdv, i, currentTarget.id) - 1));
                    requiredTactic = i;
                    break;
                }
            }
            // Not enough healthy soldiers, keep resting
            if (!requiredBattalion || requiredBattalion > m.availableGarrison) {
                return;
            }
        }

        // Occupy can pull soldiers from ships, let's make sure it won't happen
        if (!currentTarget.released && (currentTarget.gov.anx || currentTarget.gov.buy || currentTarget.gov.occ)) {
            // If it occupied currently - we'll get enough soldiers just by unoccupying it
            m.release(currentTarget.id);
        }
        else if (requiredTactic === 4 && game.global.settings.showPortal) {
            let missingSoldiers = getOccCosts() - (m.currentCityGarrison - requiredBattalion);
            if (missingSoldiers > 0) {
                // Not enough soldiers in city, let's try to pull them from hell
                if (!settings.autoHell || !m._hellVue || m.hellSoldiers - m.hellReservedSoldiers < missingSoldiers) {
                    return;
                }
                let patrolsToRemove = Math.ceil((missingSoldiers - m.hellGarrison) / m.hellPatrolSize);
                if (patrolsToRemove > 0) {
                    m.removeHellPatrol(patrolsToRemove);
                }
                m.removeHellGarrison(missingSoldiers);
            }
        }

        // Set attack type
        m.setTactic(requiredTactic);

        // Now adjust our battalion size to fit between our campaign attack rating ranges
        let deltaBattalion = requiredBattalion - m.raid;
        if (deltaBattalion > 0) {
            m.addBattalion(deltaBattalion);
        }
        if (deltaBattalion < 0) {
            m.removeBattalion(deltaBattalion * -1);
        }

        // Log the interaction
        let campaignTitle = m.getCampaignTitle(requiredTactic);
        let battalionRating = game.armyRating(m.raid, "army");
        let advantagePercent = m.getAdvantage(battalionRating, requiredTactic, currentTarget.id).toFixed(1);
        GameLog.logSuccess("attack", `Launching ${campaignTitle} campaign against ${getGovName(currentTarget.id)} with ${currentTarget.gov.spy < 1 ? "~" : ""}${advantagePercent}% advantage.`, ['combat']);

        m.launchCampaign(currentTarget.id);
    }

    function autoHell() {
        let m = WarManager;
        if (!m._garrisonVue || !m._hellVue) {
            return;
        }

        // Determine Patrol size and count
        let targetHellSoldiers = 0;
        let targetHellPatrols = 0;
        let targetHellPatrolSize = 0;
        // First handle not having enough soldiers, then handle patrols
        // Only go into hell at all if soldiers are close to full, or we are already there
        if (m.maxSoldiers > settings.hellHomeGarrison + settings.hellMinSoldiers &&
           (m.hellSoldiers > settings.hellMinSoldiers || (m.currentSoldiers >= m.maxSoldiers * settings.hellMinSoldiersPercent / 100))) {
            targetHellSoldiers = Math.min(m.currentSoldiers, m.maxSoldiers) - settings.hellHomeGarrison; // Leftovers from an incomplete patrol go to hell garrison
            let availableHellSoldiers = targetHellSoldiers - m.hellReservedSoldiers;

            // Determine target hell garrison size
            // Estimated average damage is roughly 35 * threat / defense, so required defense = 35 * threat / targetDamage
            // But the threat hitting the fortress is only an intermediate result in the bloodwar calculation, it happens after predators and patrols but before repopulation,
            // So siege threat is actually lower than what we can see. Patrol and drone damage is wildly swingy and hard to estimate, so don't try to estimate the post-fight threat.
            // Instead base the defense on the displayed threat, and provide an option to bolster defenses when the walls get low. The threat used in the calculation
            // ranges from 1 * threat for 100% walls to the multiplier entered in the settings at 0% walls.
            let hellWallsMulti = settings.hellLowWallsMulti * (1 - game.global.portal.fortress.walls / 100); // threat modifier from damaged walls = 1 to lowWallsMulti
            let hellTargetFortressDamage = game.global.portal.fortress.threat * 35 / settings.hellTargetFortressDamage; // required defense to meet target average damage based on current threat
            let hellTurretPower = buildings.PortalTurret.stateOnCount * (game.global.tech['turret'] ? (game.global.tech['turret'] >= 2 ? 70 : 50) : 35); // turrets count and power
            let hellGarrison = m.getSoldiersForAttackRating(Math.max(0, hellWallsMulti * hellTargetFortressDamage - hellTurretPower)); // don't go below 0

            // Always have at least half our hell contingent available for patrols, and if we cant defend properly just send everyone
            if (availableHellSoldiers < hellGarrison) {
                hellGarrison = 0; // If we cant defend adequately, send everyone out on patrol
            } else if (availableHellSoldiers < hellGarrison * 2) {
                hellGarrison = Math.floor(availableHellSoldiers / 2); // Always try to send out at least half our people
            }

            // Determine the patrol attack rating
            if (settings.hellHandlePatrolSize) {
                let patrolRating = game.global.portal.fortress.threat * settings.hellPatrolThreatPercent / 100;

                // Now reduce rating based on drones, droids and bootcamps
                if (game.global.portal.war_drone) {
                    patrolRating -= settings.hellPatrolDroneMod * game.global.portal.war_drone.on * (game.global.tech['portal'] >= 7 ? 1.5 : 1);
                }
                if (game.global.portal.war_droid) {
                    patrolRating -= settings.hellPatrolDroidMod * game.global.portal.war_droid.on * (game.global.tech['hdroid'] ? 2 : 1);
                }
                if (game.global.city.boot_camp) {
                    patrolRating -= settings.hellPatrolBootcampMod * game.global.city.boot_camp.count;
                }

                // In the end, don't go lower than the minimum...
                patrolRating = Math.max(patrolRating, settings.hellPatrolMinRating);

                // Increase patrol attack rating if alive soldier count is low to reduce patrol losses
                if (settings.hellBolsterPatrolRating > 0 && settings.hellBolsterPatrolPercentTop > 0) { // Check if settings are on
                    const homeGarrisonFillRatio = m.currentCityGarrison / m.maxCityGarrison;
                    if (homeGarrisonFillRatio <= settings.hellBolsterPatrolPercentTop / 100) { // If less than top
                        if (homeGarrisonFillRatio <= settings.hellBolsterPatrolPercentBottom / 100) { // and less than bottom
                            patrolRating += settings.hellBolsterPatrolRating; // add full rating
                        } else if (settings.hellBolsterPatrolPercentBottom < settings.hellBolsterPatrolPercentTop) { // If between bottom and top
                            patrolRating += settings.hellBolsterPatrolRating * (settings.hellBolsterPatrolPercentTop / 100 - homeGarrisonFillRatio) // add rating proportional to where in the range we are
                                              / (settings.hellBolsterPatrolPercentTop - settings.hellBolsterPatrolPercentBottom) * 100;
                        }
                    }
                }

                // Patrol size
                targetHellPatrolSize = m.getSoldiersForAttackRating(patrolRating);

                // If patrol size is larger than available soldiers, send everyone available instead of 0
                targetHellPatrolSize = Math.min(targetHellPatrolSize, availableHellSoldiers - hellGarrison);
            } else {
                targetHellPatrolSize = m.hellPatrolSize;
            }

            // Determine patrol count
            targetHellPatrols = Math.max(1, Math.floor((availableHellSoldiers - hellGarrison) / targetHellPatrolSize));

            // Special logic for small number of patrols
            if (settings.hellHandlePatrolSize && targetHellPatrols === 1) {
                // If we could send 1.5 patrols, send 3 half-size ones instead
                if ((availableHellSoldiers - hellGarrison) >= 1.5 * targetHellPatrolSize) {
                    targetHellPatrolSize = Math.floor((availableHellSoldiers - hellGarrison) / 3);
                    targetHellPatrols = Math.floor((availableHellSoldiers - hellGarrison) / targetHellPatrolSize);
                }
            }
        } else {
            // Try to leave hell if any soldiers are still assigned so the game doesn't put miniscule amounts of soldiers back
            if (m.hellAssigned > 0) {
                m.removeHellPatrolSize(m.hellPatrolSize);
                m.removeHellPatrol(m.hellPatrols);
                m.removeHellGarrison(m.hellSoldiers);
                return;
            }
        }

        // Adjust values ingame
        // First decrease patrols, then put hell soldiers to the right amount, then increase patrols, to make sure all actions go through
        if (settings.hellHandlePatrolSize && m.hellPatrolSize > targetHellPatrolSize) m.removeHellPatrolSize(m.hellPatrolSize - targetHellPatrolSize);
        if (m.hellPatrols > targetHellPatrols) m.removeHellPatrol(m.hellPatrols - targetHellPatrols);
        if (m.hellSoldiers > targetHellSoldiers) m.removeHellGarrison(m.hellSoldiers - targetHellSoldiers);
        if (m.hellSoldiers < targetHellSoldiers) m.addHellGarrison(targetHellSoldiers - m.hellSoldiers);
        if (settings.hellHandlePatrolSize && m.hellPatrolSize < targetHellPatrolSize) m.addHellPatrolSize(targetHellPatrolSize - m.hellPatrolSize);
        if (m.hellPatrols < targetHellPatrols) m.addHellPatrol(targetHellPatrols - m.hellPatrols);
    }

    // TODO: Some way to use servant crafters only
    function autoJobs(craftOnly) {
        let jobList = JobManager.managedPriorityList();

        // No jobs unlocked yet
        if (jobList.length === 0) {
            return;
        }

        let farmerIndex = game.global.race['artifical'] ? -1 : Math.max(jobList.indexOf(jobs.Hunter), jobList.indexOf(jobs.Farmer));
        let lumberjackIndex = isDemonRace() && isLumberRace() ? farmerIndex : jobList.indexOf(jobs.Lumberjack);
        let quarryWorkerIndex = jobList.indexOf(jobs.QuarryWorker);
        let crystalMinerIndex = jobList.indexOf(jobs.CrystalMiner);
        let scavengerIndex = jobList.indexOf(jobs.Scavenger);
        let defaultIndex = jobList.findIndex(job => job.isDefault());

        let availableWorkers = jobList.reduce((total, job) => total + job.workers, 0);
        let availableServants = settings.jobManageServants ? JobManager.servantsMax() : 0;
        let availableSkilledServants = settings.jobManageServants ? JobManager.skilledServantsMax() : 0;
        let availableCraftsmen = JobManager.craftingMax();
        let servantMod = traitVal('high_pop', 0, 1);

        let crewMissing = game.global.civic.crew.max - game.global.civic.crew.workers;
        let minDefault = crewMissing > 0 ? crewMissing + 1 : 0;

        let requiredWorkers = new Array(jobList.length).fill(0);
        let requiredServants = new Array(jobList.length).fill(0);

        // We're only crafting when we have twice amount of workers than needed.
        if (craftOnly) {
            availableCraftsmen = availableWorkers;
            availableWorkers = 0;
            availableServants = 0;
        } else if (settings.autoCraftsmen && availableWorkers >= availableCraftsmen * (farmerIndex === -1 ? 1 : 2)) {
            availableWorkers -= availableCraftsmen;
        } else {
            availableCraftsmen = 0;
        }

        // Now assign crafters
        if (settings.autoCraftsmen){
            // Taken from game source, no idea what this "140" means.
            let speed = game.global.genes['crafty'] ? 2 : 1;
            let costMod = speed * traitVal('resourceful', 0, '-') / 140;
            let totalCraftsmen = availableCraftsmen + (availableSkilledServants * servantMod);
            let autoCraft = settings.productionCraftsmen === "always" || (settings.productionCraftsmen === "nocraft" && game.global.race['no_craft']);

            // Get list of craftabe resources
            let availableJobs = [];
            for (let job of JobManager.craftingJobs) {
                let resource = job.resource;
                // Check if we're allowed to craft this resource
                if (!job.isManaged() || !resource.autoCraftEnabled) {
                    continue;
                }

                // Check workshop
                let craftBuilding = job === crafter.Scarletite ? buildings.RuinsHellForge :
                                    job === crafter.Quantium ? (haveTech("isolation") ? buildings.TauDiseaseLab : buildings.EnceladusZeroGLab) :
                                    null;
                if (!craftBuilding && !autoCraft) {
                    // Other jobs need to be checked only if we have servants to assign
                    if (!availableSkilledServants) {
                        break;
                    }
                    // Empty crafters pool, we're not going to assign them
                    availableWorkers += availableCraftsmen;
                    totalCraftsmen -= availableCraftsmen;
                    availableCraftsmen = 0;
                }

                // Check if there's enough resources to craft it for at least 2 ticks
                let affordableAmount = totalCraftsmen;
                for (let res in resource.cost) {
                    let reqResource = resources[res];
                    if (!resource.isDemanded() && ((!settings.useDemanded && reqResource.isDemanded()) || reqResource.storageRatio < resource.craftPreserve)) {
                        affordableAmount = 0;
                        break;
                    } else {
                        affordableAmount = Math.min(affordableAmount, (resource.rateOfChange + reqResource.currentQuantity) / (resource.cost[res] * costMod) / 2 * ticksPerSecond());
                    }
                }

                if (craftBuilding) {
                    if (settings.productionCraftsmen === "servants") {
                        continue; // Servants can't work in buildings
                    }
                    // Assigning non-foundry crafters right now, so it won't be filtered out by priority checks below, as we want to have them always crafted among with regular craftables
                    let craftMax = craftBuilding.stateOnCount * traitVal('high_pop', 0, 1);
                    if (affordableAmount < craftMax) {
                        requiredWorkers[jobList.indexOf(job)] = 0;
                    } else {
                        requiredWorkers[jobList.indexOf(job)] = craftMax;
                        availableCraftsmen -= craftMax;
                        totalCraftsmen -= craftMax;
                    }
                } else if (affordableAmount >= totalCraftsmen){
                    availableJobs.push(job);
                }
            }

            let requestedJobs = availableJobs.filter(job => job.resource.isDemanded());
            if (requestedJobs.length > 0) {
                availableJobs = requestedJobs;
            } else if (settings.productionFoundryWeighting === "demanded") {
                let usefulJobs = availableJobs.filter(job => job.resource.currentQuantity < job.resource.storageRequired);
                if (usefulJobs.length > 0) {
                    availableJobs = usefulJobs;
                }
            }

            if (settings.productionFoundryWeighting === "buildings" && state.unlockedBuildings.length > 0) {
                let scaledWeightings = Object.fromEntries(availableJobs.map(job => [job.id, (state.unlockedBuildings.find(building => building.cost[job.resource.id] > job.resource.currentQuantity)?.weighting ?? 0) * job.resource.craftWeighting]));
                availableJobs.sort((a, b) => (a.resource.currentQuantity / scaledWeightings[a.id]) - (b.resource.currentQuantity / scaledWeightings[b.id]));
            } else {
                availableJobs.sort((a, b) => (a.resource.currentQuantity / a.resource.craftWeighting) - (b.resource.currentQuantity / b.resource.craftWeighting));
            }

            for (let job of JobManager.craftingJobs) {
                let jobIndex = jobList.indexOf(job);

                if (jobIndex === -1
                    || (job === crafter.Scarletite && resources.Scarletite.autoCraftEnabled)
                    || (job === crafter.Quantium && resources.Quantium.autoCraftEnabled) ) {
                    continue;
                }

                // Having empty array and undefined availableJobs[0] is fine - we still need to remove other crafters.
                if (job === availableJobs[0]){
                    requiredWorkers[jobIndex] = availableCraftsmen;
                    requiredServants[jobIndex] = availableSkilledServants;
                } else {
                    requiredWorkers[jobIndex] = 0;
                    requiredServants[jobIndex] = 0;
                }
            }

            // We didn't assigned crafter for some reason, return employees so we can use them somewhere else
            if (availableJobs[0] === undefined){
                availableWorkers += availableCraftsmen;
            }
        }

        let coalDisabled = settings.jobDisableMiners && buildings.GatewayStarbase.count > 0;
        let minersDisabled = coalDisabled && !(game.global.race['sappy'] && game.global.race['smoldering']);
        let hoovedMiner = game.global.race.hooved && resources.Horseshoe.usefulRatio < 1;
        let synthMiner = game.global.race.artifical && !game.global.race.deconstructor && resources.Population.storageRatio < 1;
        let minerIndex = jobList.indexOf(jobs.Miner);

        // Make sure our hooved have miner for horseshoes\assemble
        if ((hoovedMiner || synthMiner) && !minersDisabled && availableWorkers > 1 && minerIndex !== -1 && jobs.Miner.isSmartEnabled) {
            requiredWorkers[minerIndex] = 1;
            availableWorkers--;
        }

        let jobMax = {};
        let minFarmers = 0;
        state.maxSpaceMiners = 0;
        // And deal with the rest now
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < jobList.length; j++) {
                let job = jobList[j];

                // Don't assign 3rd breakpoints for jobs we're going to split, just first two to reserve some workers
                if (i === 2 && job.is.split) {
                    continue;
                }
                // We've already done with crafters
                if (job instanceof CraftingJob) {
                    continue;
                }

                availableWorkers += requiredWorkers[j];
                let currentEmployees = requiredWorkers[j];
                let availableEmployees = availableWorkers;
                requiredWorkers[j] = 0;
                if (job.is.serve) {
                    currentEmployees += requiredServants[j] * servantMod;
                    availableServants += requiredServants[j];
                    availableEmployees += availableServants * servantMod;
                    requiredServants[j] = 0;
                }

                let demonicLumber = (job === jobs.Hunter && isDemonRace() && isLumberRace()) ? true : false;
                let jobsToAssign = Math.min(availableEmployees, Math.max(currentEmployees, job.breakpointEmployees(i)));

                if (job.isSmartEnabled) {
                    if (job === jobs.Farmer || job === jobs.Hunter) {
                        if (jobMax[j] === undefined) {
                            // Food
                            if (game.global.race['artifical'] || game.global.race['unfathomable']) {
                                // Artifical hunters and raiders doesn't produce food
                                jobMax[j] = 0;
                            } else {
                                let foodRateOfChange = resources.Food.rateOfChange;
                                let minFoodStorage = resources.Food.maxQuantity * 0.2;
                                let maxFoodStorage = resources.Food.maxQuantity * 0.6;
                                if (game.global.race['ravenous']) { // Ravenous hunger
                                    minFoodStorage = resources.Population.currentQuantity * 1.5;
                                    maxFoodStorage = resources.Population.currentQuantity * 3;
                                    foodRateOfChange += Math.max(resources.Food.currentQuantity / traitVal('ravenous', 1), 0);
                                }
                                if (game.global.race['carnivore']) { // Food spoilage
                                    minFoodStorage = resources.Population.currentQuantity;
                                    maxFoodStorage = resources.Population.currentQuantity * 2;
                                    if (resources.Food.currentQuantity > 10) {
                                        foodRateOfChange += (resources.Food.currentQuantity - 10) * traitVal('carnivore', 0, '=') * (0.9 ** buildings.Smokehouse.count);
                                    }
                                }

                                if (resources.Population.currentQuantity > state.lastPopulationCount) {
                                    let populationChange = resources.Population.currentQuantity - state.lastPopulationCount;
                                    let farmerChange = job.count - state.lastFarmerCount;

                                    if (populationChange === farmerChange && foodRateOfChange > 0) {
                                        jobMax[j] = job.count - populationChange;
                                    } else {
                                        jobMax[j] = job.count;
                                    }
                                } else if (resources.Food.isCapped()) {
                                    // Full food storage, remove all farmers instantly
                                    jobMax[j] = 0;
                                } else if (resources.Food.currentQuantity + foodRateOfChange / ticksPerSecond() < minFoodStorage) {
                                    // We want food to fluctuate between 0.2 and 0.6 only. We only want to add one per loop until positive
                                    if (job.count === 0) { // We can't calculate production with no workers, assign one first
                                        jobMax[j] = 1;
                                    } else {
                                        let foodPerWorker = resources.Food.getProduction("job_" + job.id) / job.count;
                                        let missingWorkers = Math.ceil(foodRateOfChange / -foodPerWorker) || 0;
                                        jobMax[j] = Math.max(1, job.count + missingWorkers);
                                    }
                                } else if (resources.Food.currentQuantity > maxFoodStorage && foodRateOfChange > 0) {
                                    // We want food to fluctuate between 0.2 and 0.6 only. We only want to remove one per loop until negative
                                    jobMax[j] = job.count - 1;
                                } else {
                                    // We're good; leave farmers as they are
                                    jobMax[j] = job.count;
                                }
                                minFarmers = jobMax[j];
                            }

                            // Other byproducts
                            if (game.global.race['unfathomable']) {
                                // Raiders brings a lot of different stuff, let's just assume they're always usefull, without wasting time checking all those resources
                                jobMax[j] = Number.MAX_SAFE_INTEGER;
                            } else if (job === jobs.Hunter) {
                                if (resources.Furs.isUnlocked() && (game.global.race['evil'] || game.global.race['artifical'])) {
                                    jobMax[j] = resources.Furs.isUseful() ? Number.MAX_SAFE_INTEGER
                                      : Math.max(jobMax[j], resources.Furs.getBusyWorkers("job_hunter", jobs.Hunter.count));
                                }
                                if (demonicLumber) {
                                    jobMax[j] = resources.Lumber.isUseful() ? Number.MAX_SAFE_INTEGER
                                      : Math.max(jobMax[j], resources.Lumber.getBusyWorkers("job_hunter", jobs.Hunter.count));
                                }
                            }
                        }
                        if (demonicLumber) {
                            jobsToAssign = Math.min(availableEmployees, Math.max(currentEmployees, minFarmers, Math.min(jobMax[j], jobs.Lumberjack.breakpointEmployees(i))));
                        } else {
                            jobsToAssign = Math.min(jobsToAssign, minFarmers);
                        }
                    }
                    if (job === jobs.Lumberjack) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = 0;
                            if (!game.global.race['soul_eater'] && game.global.race['evil']) {
                                jobMax[j] = resources.Furs.isUseful() ? Number.MAX_SAFE_INTEGER
                                  : resources.Furs.getBusyWorkers("job_reclaimer", jobs.Lumberjack.count);
                            }
                            jobMax[j] = resources.Lumber.isUseful() ? Number.MAX_SAFE_INTEGER
                              : Math.max(jobMax[j], resources.Lumber.getBusyWorkers(game.global.race['evil'] ? "job_reclaimer" : "job_lumberjack", jobs.Lumberjack.count));
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.QuarryWorker) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = 0;
                            if (resources.Aluminium.isUnlocked()) {
                                jobMax[j] = resources.Aluminium.isUseful() ? Number.MAX_SAFE_INTEGER
                                  : Math.max(jobMax[j], resources.Aluminium.getBusyWorkers("workers", jobs.QuarryWorker.count));
                            }
                            if (resources.Chrysotile.isUnlocked()) {
                                jobMax[j] = resources.Chrysotile.isUseful() ? Number.MAX_SAFE_INTEGER
                                  : Math.max(jobMax[j], resources.Chrysotile.getBusyWorkers("workers", jobs.QuarryWorker.count));
                            }
                            jobMax[j] = resources.Stone.isUseful() ? Number.MAX_SAFE_INTEGER
                              : Math.max(jobMax[j], resources.Stone.getBusyWorkers("workers", jobs.QuarryWorker.count));
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.CrystalMiner) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = resources.Crystal.isUseful() ? Number.MAX_SAFE_INTEGER
                              : resources.Crystal.getBusyWorkers("job_crystal_miner", jobs.CrystalMiner.count);
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.Torturer) {
                        if (jobMax[j] === undefined) {
                            let total = 0;
                            for (let i = 0; i < game.global.city.surfaceDwellers.length; i++) {
                                total += game.global.city.captive_housing[`race${i}`];
                                total += game.global.city.captive_housing[`jailrace${i}`];
                            }
                            let rank = game.global.stats.achieve.nightmare?.mg ?? 0;
                            jobMax[j] = Math.ceil(total / (rank / 2));
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.Miner) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = 0;
                            if (!minersDisabled) {
                                if (game.global.race['sappy']) {
                                    if (resources.Aluminium.isUnlocked()) {
                                        jobMax[j] = resources.Aluminium.isUseful() ? Number.MAX_SAFE_INTEGER
                                          : Math.max(jobMax[j], resources.Aluminium.getBusyWorkers(game.global.race['cataclysm'] || game.global.race['orbit_decayed'] ? "space_red_mine_title" : "job_miner", jobs.Miner.count));
                                    }
                                    if (resources.Chrysotile.isUnlocked()) {
                                        jobMax[j] = resources.Chrysotile.isUseful() ? Number.MAX_SAFE_INTEGER
                                          : Math.max(jobMax[j], resources.Chrysotile.getBusyWorkers("job_miner", jobs.Miner.count));
                                    }
                                }
                                if (game.global.tech['titanium'] >= 2) {
                                    let shipShift = buildings.BeltIronShip.stateOnCount * 2;
                                    jobMax[j] = resources.Titanium.isUseful() ? Number.MAX_SAFE_INTEGER
                                      : Math.max(jobMax[j], resources.Titanium.getBusyWorkers("resource_Iron_name", jobs.Miner.count + shipShift) - shipShift);
                                }
                                if (resources.Iron.isUnlocked()) {
                                    jobMax[j] = resources.Iron.isUseful() ? Number.MAX_SAFE_INTEGER
                                      : Math.max(jobMax[j], resources.Iron.getBusyWorkers("job_miner", jobs.Miner.count));
                                }
                                jobMax[j] = resources.Copper.isUseful() ? Number.MAX_SAFE_INTEGER
                                  : Math.max(jobMax[j], resources.Copper.getBusyWorkers("job_miner", jobs.Miner.count));
                            }
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.CoalMiner) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = 0;
                            if (!coalDisabled) {
                                if (resources.Uranium.isUnlocked()) {
                                    jobMax[j] = resources.Uranium.isUseful() ? Number.MAX_SAFE_INTEGER
                                      : resources.Uranium.getBusyWorkers("job_coal_miner", jobs.CoalMiner.count);
                                }
                                jobMax[j] = resources.Coal.isUseful() ? Number.MAX_SAFE_INTEGER
                                  : Math.max(jobMax[j], resources.Coal.getBusyWorkers("job_coal_miner", jobs.CoalMiner.count));
                            }
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.SpaceMiner) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = (buildings.BeltEleriumShip.stateOnCount * 2 + buildings.BeltIridiumShip.stateOnCount + buildings.BeltIronShip.stateOnCount) * traitVal('high_pop', 0, 1);
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                        state.maxSpaceMiners = Math.max(state.maxSpaceMiners, Math.min(availableEmployees, job.breakpointEmployees(i, true)));
                    }
                    if (job === jobs.Entertainer && !haveTech("superstar")) {
                        if (jobMax[j] === undefined) {
                            let taxBuffer = (settings.autoTax || haveTask("tax")) && game.global.civic.taxes.tax_rate < poly.taxCap(false) ? 1 : 0;
                            let entertainerMorale = (game.global.tech['theatre'] + traitVal('musical', 0))
                                * traitVal('emotionless', 0, '-') * traitVal('high_pop', 1, '=')
                                * (state.astroSign === 'sagittarius' ? 1.05 : 1)
                                * (game.global.race['lone_survivor'] ? 25 : 1);
                            let moraleExtra = resources.Morale.rateOfChange - resources.Morale.maxQuantity - taxBuffer;
                            jobMax[j] = job.count - Math.floor(moraleExtra / entertainerMorale);
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    // TODO: Remove extra bankers when cap not needed
                    // Don't assign bankers if our money is maxed and bankers aren't contributing to our money storage cap
                    if (job === jobs.Banker && (resources.Money.isCapped() || game.global.civic.taxes.tax_rate <= 0) && !haveTech("banking", 7)) {
                        jobsToAssign = 0;
                    }
                    // Races with the Intelligent trait get bonus production based on the number of professors and scientists
                    // Only unassign them when knowledge is max if the race is not intelligent
                    // Once we've research shotgun sequencing we get boost and soon autoassemble genes so stop unassigning
                    if (job === jobs.Scientist) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = Number.MAX_SAFE_INTEGER;
                            if (game.global.race.universe !== 'magic' && resources.Knowledge.isCapped() && !game.global.race['intelligent'] && !haveTech("science", 5) && !haveTech("genetics", 5)) {
                                jobsToAssign = 0;
                            }
                            if (game.global.race['witch_hunter']) {
                                let SusPerWiz = game.global.civic.govern.type === 'magocracy' ? 0.5 : 1;
                                jobMax[j] = ((99 - resources.Sus.currentQuantity) / SusPerWiz) + (job.count * SusPerWiz);
                            }
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.Professor && !game.global.race['intelligent'] && resources.Knowledge.isCapped() && !haveTech("genetics", 5) && !haveTech("fanaticism", 2)) {
                        jobsToAssign = 0;
                    }
                    if (job === jobs.CementWorker) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = Number.MAX_SAFE_INTEGER;
                            if (resources.Stone.storageRatio < 0.1) {
                                let stoneRateOfChange = resources.Stone.rateOfChange + (job.count * 3) - 5;
                                if (game.global.race['smoldering'] && settings.autoQuarry) {
                                    stoneRateOfChange += resources.Chrysotile.rateOfChange;
                                }
                                jobMax[j] = Math.min(jobMax[j], Math.floor(stoneRateOfChange / 3));
                            }
                            if (!resources.Cement.isUseful()) {
                                jobMax[j] = Math.min(jobMax[j], resources.Cement.getBusyWorkers("city_cement_plant_bd", jobs.CementWorker.count));
                            }
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.HellSurveyor) {
                        if (jobMax[j] === undefined) {
                            if (game.global.portal.fortress.threat > 9000 && resources.Population.storageRatio < 1) {
                                jobMax[j] = 0;
                            /* Keep all surveyors active for gems
                            } else if (!resources.Infernite.isUseful()) {
                                jobMax[j] = resources.Infernite.getBusyWorkers("job_hell_surveyor", jobs.HellSurveyor.count);
                            */
                            } else {
                                jobMax[j] = Number.MAX_SAFE_INTEGER;
                            }
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                    if (job === jobs.Teamster) {
                        if (jobMax[j] === undefined) {
                            jobMax[j] = Math.round(game.global.race.teamster / (game.global.tech.transport ?? 0) * 1.5);
                            jobMax[j] -= (game.global.tech['railway'] ?? 0) * 2;
                        }
                        jobsToAssign = Math.min(jobsToAssign, jobMax[j]);
                    }
                }

                if (j === defaultIndex && minDefault > 0) {
                    requiredWorkers[j] += Math.min(availableWorkers, minDefault);
                    availableWorkers -= requiredWorkers[j];
                    jobsToAssign -= requiredWorkers[j];
                }
                if (jobsToAssign > 0 && job.is.serve) {
                    let servantsToAssign = Math.min(availableServants, Math.floor(jobsToAssign / servantMod));
                    requiredServants[j] += servantsToAssign;
                    availableServants -= servantsToAssign;
                    jobsToAssign -= servantsToAssign * servantMod;
                }
                if (jobsToAssign > 0) {
                    let workersToAssign = Math.min(jobsToAssign, availableWorkers);
                    requiredWorkers[j] += workersToAssign;
                    availableWorkers -= workersToAssign;
                }
            }

            // No more workers available
            if (availableWorkers <= 0 && availableServants <= 0) {
                break;
            }
        }

        // Avoid adjusting both tax and entertainers at same tick, it can cause flickering
        let entertainerIndex = jobList.indexOf(jobs.Entertainer);
        if (entertainerIndex !== -1 && requiredWorkers[entertainerIndex] !== jobList[entertainerIndex].count) {
            resources.Morale.incomeAdusted = true;
        }
        if (minerIndex !== -1 && requiredWorkers[minerIndex] !== jobList[minerIndex].count) {
            resources.Iron.incomeAdusted = true;
        }

        let splitJobs = [];
        if (game.global.race['unfathomable'] && farmerIndex !== -1 && settings.jobRaiderWeighting > 0) splitJobs.push({index: farmerIndex, job: jobs.Hunter, weighting: settings.jobRaiderWeighting} );
        if (lumberjackIndex !== -1 && settings.jobLumberWeighting > 0) splitJobs.push({index: lumberjackIndex, job: jobs.Lumberjack, weighting: settings.jobLumberWeighting} );
        if (quarryWorkerIndex !== -1 && settings.jobQuarryWeighting > 0) splitJobs.push({index: quarryWorkerIndex, job: jobs.QuarryWorker, weighting: settings.jobQuarryWeighting});
        if (crystalMinerIndex !== -1 && settings.jobCrystalWeighting > 0) splitJobs.push({index: crystalMinerIndex, job: jobs.CrystalMiner, weighting: settings.jobCrystalWeighting});
        if (scavengerIndex !== -1 && settings.jobScavengerWeighting > 0) splitJobs.push({index: scavengerIndex, job: jobs.Scavenger, weighting: settings.jobScavengerWeighting});

        // Balance lumberjacks, quarry workers, crystal miners and scavengers if they are unlocked
        if (splitJobs.length > 0) {
            // Reduce jobs required down to minimum and add them to the available employee pool so that we can split them according to weightings
            splitJobs.forEach(jobDetails => {
                availableWorkers += requiredWorkers[jobDetails.index];
                requiredWorkers[jobDetails.index] = 0;
                availableServants += requiredServants[jobDetails.index];
                requiredServants[jobDetails.index] = 0;
            });

            if (splitJobs.find(s => s.index === defaultIndex) && minDefault > requiredWorkers[defaultIndex]) {
                let restoreDef = Math.min(availableWorkers, minDefault - requiredWorkers[defaultIndex]);
                requiredWorkers[defaultIndex] += restoreDef;
                availableWorkers -= restoreDef;
            }
            let currentFarmers = (requiredWorkers[farmerIndex] + requiredServants[farmerIndex] * servantMod);
            if (splitJobs.find(s => s.index === farmerIndex) && minFarmers > currentFarmers) {
                let missingFarmers = minFarmers - currentFarmers;
                let servantsToAssign = Math.min(availableServants, Math.floor(missingFarmers / servantMod));
                requiredServants[farmerIndex] += servantsToAssign;
                availableServants -= servantsToAssign;
                missingFarmers -= servantsToAssign * servantMod;
                if (missingFarmers > 0) {
                    let workersToAssign = Math.min(availableWorkers, missingFarmers);
                    requiredWorkers[farmerIndex] += workersToAssign;
                    availableWorkers -= workersToAssign;
                    missingFarmers -= workersToAssign;
                }
            }

            // Bring them all up to required breakpoints, one each at a time
            let splitSorter = (a, b) => (((requiredWorkers[a.index] + (requiredServants[a.index] * servantMod)) / a.weighting)
                                       - ((requiredWorkers[b.index] + (requiredServants[b.index] * servantMod)) / b.weighting))
                                       || a.index - b.index;
            for (let b = 0; b < 3 && (availableWorkers > 0 || availableServants > 0); b++) {
                let remainingJobs = splitJobs.slice();
                while ((availableWorkers + availableServants) > 0 && remainingJobs.length > 0) {
                    let jobDetails = remainingJobs.sort(splitSorter)[0];
                    let total = requiredWorkers[jobDetails.index] + (requiredServants[jobDetails.index] * servantMod);
                    let bp = jobDetails.job.getBreakpoint(b) > 0 ? jobDetails.job.breakpointEmployees(b) : 0;
                    if ((b === 2 || total < bp) && !(total >= jobMax[jobDetails.index])) {
                        if (availableServants > 0) {
                            requiredServants[jobDetails.index]++;
                            availableServants--;
                        } else {
                            requiredWorkers[jobDetails.index]++;
                            availableWorkers--;
                        }
                    } else {
                        remainingJobs.shift();
                    }
                }
            }
        }

        // Still have free workers, drop them anywhere
        let fallback = [farmerIndex, lumberjackIndex, quarryWorkerIndex, crystalMinerIndex, scavengerIndex];
        while ((availableWorkers > 0 || availableServants > 0) && fallback.length > 0) {
            let idx = fallback.pop();
            if (idx !== -1) {
                requiredWorkers[idx] += availableWorkers;
                availableWorkers = 0;
                requiredServants[idx] += availableServants;
                availableServants = 0;
            }
        }

        let workerDeltas = requiredWorkers.map((req, index) => req - jobList[index].workers);
        workerDeltas.forEach((delta, index) => delta < 0 && jobList[index].removeWorkers(delta * -1));
        workerDeltas.forEach((delta, index) => delta > 0 && jobList[index].addWorkers(delta));

        if (settings.jobManageServants && !$.isEmptyObject(game.global.race.servants?.jobs ?? {})) {
            let servantDeltas = requiredServants.map((req, index) => req - jobList[index].servants);
            servantDeltas.forEach((delta, index) => delta < 0 && jobList[index].removeServants(delta * -1));
            servantDeltas.forEach((delta, index) => delta > 0 && jobList[index].addServants(delta));
        }

        state.lastPopulationCount = resources.Population.currentQuantity;
        state.lastFarmerCount = farmerIndex === -1 ? 0 : (requiredWorkers[farmerIndex] + requiredServants[farmerIndex] * servantMod);

        // After reassignments adjust default job to something with workers, we need that for sacrifices.
        if (!craftOnly && settings.jobSetDefault) {
            /*if (jobs.Forager.isManaged() && requiredWorkers[jobList.indexOf(jobs.Forager)] > 0) {
                jobs.Forager.setAsDefault();
            } else*/
            if (jobs.QuarryWorker.isManaged() && requiredWorkers[quarryWorkerIndex] > 0) {
                jobs.QuarryWorker.setAsDefault();
            } else if (jobs.Lumberjack.isManaged() && requiredWorkers[lumberjackIndex] > 0) {
                jobs.Lumberjack.setAsDefault();
            } else if (jobs.CrystalMiner.isManaged() && requiredWorkers[crystalMinerIndex] > 0) {
                jobs.CrystalMiner.setAsDefault();
            } else if (jobs.Scavenger.isManaged() && requiredWorkers[scavengerIndex] > 0) {
                jobs.Scavenger.setAsDefault();
            } else if (jobs.Hunter.isManaged()) {
                jobs.Hunter.setAsDefault();
            } else if (jobs.Farmer.isManaged()) {
                jobs.Farmer.setAsDefault();
            } else if (jobs.Teamster.isManaged()) {
                jobs.Teamster.setAsDefault();
            } else if (jobs.Unemployed.isManaged()) {
                jobs.Unemployed.setAsDefault();
            }
        }
    }

    function autoTax() {
        if (resources.Morale.incomeAdusted) {
            return;
        }

        let taxVue = getVueById('tax_rates');
        if (taxVue === undefined || !game.global.civic.taxes.display) {
            return;
        }

        let currentTaxRate = game.global.civic.taxes.tax_rate;
        let currentMorale = resources.Morale.currentQuantity;
        let realMorale = resources.Morale.rateOfChange;
        let maxMorale = resources.Morale.maxQuantity;
        let minMorale = settings.generalMinimumMorale;

        let maxTaxRate = poly.taxCap(false);
        let minTaxRate = poly.taxCap(true);

        if (settings.generalRequestedTaxRate != -1) {
            var requestedTaxRateCappedToLimits = Math.min(Math.max(settings.generalRequestedTaxRate, minTaxRate), maxTaxRate);
            KeyManager.set(false, false, false);
            while(currentTaxRate > requestedTaxRateCappedToLimits) {
                taxVue.sub();
                currentTaxRate--;
            }
            while(currentTaxRate < requestedTaxRateCappedToLimits) {
                taxVue.add();
                currentTaxRate++;
            }
            resources.Morale.incomeAdusted = true;
            return;
        }

        if (resources.Money.storageRatio < 0.9 && !game.global.race['banana']) {
            minTaxRate = Math.max(minTaxRate, settings.generalMinimumTaxRate);
        }

        let optimalTax = game.global.race['banana'] ? minTaxRate :
                         resources.Money.isDemanded() ? maxTaxRate :
                         Math.round((maxTaxRate - minTaxRate) * Math.max(0, 0.9 - resources.Money.storageRatio)) + minTaxRate;

        if (!game.global.race['banana']) {
            if (currentTaxRate < 20) { // Exposed morale cap includes bonus of current low taxes, roll it back
                maxMorale -= 10 - Math.floor(currentTaxRate / 2);
            }
            if (optimalTax < 20) {  // And add full bonus if we actually need it
                maxMorale += 10 - Math.floor(minTaxRate / 2);
            }
        }
        if (resources.Money.storageRatio < 0.9) {
            maxMorale = Math.min(maxMorale, settings.generalMaximumMorale);
        }

        if (currentTaxRate < maxTaxRate && currentMorale >= minMorale + 1 &&
              (currentTaxRate < optimalTax || currentMorale >= maxMorale + 1 || (realMorale >= currentMorale + 1 && optimalTax >= 20))) {
            KeyManager.set(false, false, false);
            taxVue.add();
            resources.Morale.incomeAdusted = true;
        }

        if (currentTaxRate > minTaxRate && currentMorale < maxMorale &&
              (currentTaxRate > optimalTax || currentMorale < minMorale)) {
            KeyManager.set(false, false, false);
            taxVue.sub();
            resources.Morale.incomeAdusted = true;
        }

    }

    function autoAlchemy() {
        let m = AlchemyManager;
        if (!m.isUnlocked()) {
            return;
        }

        let fullList = m.managedPriorityList();
        let adjustAlchemy = Object.fromEntries(fullList.map(res => [res.id, m.currentCount(res.id) * -1]));

        // Calculate required transmutations
        if (!resources.Crystal.isDemanded()) {
            let activeList = fullList.filter(res => m.resWeighting(res.id) > 0 && res.isUseful());
            let totalWeigthing = 0, currentTransmute = 0;
            for (let res of activeList) {
                totalWeigthing += m.resWeighting(res.id);
                currentTransmute += m.currentCount(res.id);
            }
            let manaAvailable = (currentTransmute + resources.Mana.rateOfChange) * ((!settings.autoPylon && resources.Mana.storageRatio > 0.99) ? 1 : settings.magicAlchemyManaUse);
            let crystalAvailable = currentTransmute * 0.15 + resources.Crystal.currentQuantity + resources.Crystal.rateOfChange;
            let maxTransmute = Math.floor(Math.min(manaAvailable, crystalAvailable * (1/0.15)));
            activeList.forEach(res => adjustAlchemy[res.id] += Math.floor(maxTransmute * (m.resWeighting(res.id) / totalWeigthing)));
        }

        // Apply adjustment
        Object.entries(adjustAlchemy).forEach(([id, delta]) => delta < 0 && m.transmuteLess(id, delta * -1));
        Object.entries(adjustAlchemy).forEach(([id, delta]) => delta > 0 && m.transmuteMore(id, delta));
    }

    function autoPylon() {
        let m = RitualManager;
        // If not unlocked then nothing to do
        if (!m.initIndustry()) {
            return;
        }

        let spells = Object.values(m.Productions).filter(spell => spell.isUnlocked());

        // Init adjustment, and sort groups by priorities
        let pylonAdjustments = Object.fromEntries(spells.map(spell => [spell.id, 0]));
        let manaToUse = resources.Mana.rateOfChange * (resources.Mana.storageRatio > 0.99 ? 1 : settings.productionRitualManaUse);
        let usableMana = manaToUse;
        let maxRituals = (settings.productionRitualSafe && game.global.race['witch_hunter'])
            ? (jobs.Priest.count * (haveTech("roguemagic", 4) ? 4 : 1))
            : Number.MAX_SAFE_INTEGER;

        let spellSorter = (a, b) => ((pylonAdjustments[a.id] / a.weighting) - (pylonAdjustments[b.id] / b.weighting)) || b.weighting - a.weighting;
        let remainingSpells = spells.filter(spell => spell.weighting > 0 && (spell !== m.Productions.Factory || jobs.CementWorker.count > 0)).sort(spellSorter);
        spellsLoop:
        while(remainingSpells.length > 0 && maxRituals > 0) {
            let spell = remainingSpells.shift();
            let amount = pylonAdjustments[spell.id];
            let cost = m.costStep(amount);

            if (cost <= manaToUse) {
                pylonAdjustments[spell.id] = amount + 1;
                manaToUse -= cost;
                maxRituals--;
                // Insert spell back to array keeping it sorted
                for (let i = remainingSpells.length - 1; i >= 0; i--) {
                    if (spellSorter(spell, remainingSpells[i]) > 0) {
                        remainingSpells.splice(i + 1, 0, spell);
                        continue spellsLoop;
                    }
                }
                remainingSpells.unshift(spell);
            }
        }
        resources.Mana.rateOfChange - (usableMana - manaToUse);

        let pylonDeltas = spells.map((spell) => pylonAdjustments[spell.id] - m.currentSpells(spell));

        spells.forEach((spell, index) => pylonDeltas[index] < 0 && m.decreaseRitual(spell, pylonDeltas[index] * -1));
        spells.forEach((spell, index) => pylonDeltas[index] > 0 && m.increaseRitual(spell, pylonDeltas[index]));
    }

    function autoQuarry() {
        // Nothing to do here with no quarry, or smoldering
        if (!QuarryManager.initIndustry()) {
            return;
        }

        let chrysotileWeigth = resources.Chrysotile.isDemanded() ? Number.MAX_SAFE_INTEGER : (100 - resources.Chrysotile.storageRatio * 100);
        let stoneWeigth = resources.Stone.isDemanded() ? Number.MAX_SAFE_INTEGER : (100 - resources.Stone.storageRatio * 100);
        if (buildings.MetalRefinery.count > 0) {
            stoneWeigth = Math.max(stoneWeigth, resources.Aluminium.isDemanded() ? Number.MAX_SAFE_INTEGER : (100 - resources.Aluminium.storageRatio * 100));
        }
        chrysotileWeigth *= settings.productionChrysotileWeight;

        let currentRatio = QuarryManager.currentProduction();
        let newRatio = Math.round(chrysotileWeigth / (chrysotileWeigth + stoneWeigth) * 100);

        QuarryManager.increaseProduction(newRatio - currentRatio);
    }

    function autoMine() {
        // Nothing to do here with no mine
        if (!MineManager.initIndustry()) {
            return;
        }

        let adamantiteWeigth = resources.Adamantite.isDemanded() ? Number.MAX_SAFE_INTEGER : (100 - resources.Adamantite.storageRatio * 100);
        let aluminiumWeight = resources.Aluminium.isDemanded() ? Number.MAX_SAFE_INTEGER : (100 - resources.Aluminium.storageRatio * 100);

        adamantiteWeigth *= settings.productionAdamantiteWeight;

        let currentRatio = MineManager.currentProduction();
        let newRatio = Math.round(adamantiteWeigth / (adamantiteWeigth + aluminiumWeight) * 100);

        MineManager.increaseProduction(newRatio - currentRatio);
    }


    function autoExtractor() {
        // Nothing to do here with no moneg
        if (!ExtractorManager.initIndustry()) {
            return;
        }

        let productions = [{id: "common", res1: "Iron", res2: "Aluminium"},
                           {id: "uncommon", res1: "Iridium", res2: "Neutronium"}];
        if (haveTech("tau_roid", 5)) {
            productions.push({id: "rare", res1: "Orichalcum", res2: "Elerium"});
        }

        for (let prod of productions) {
            let res1Weight = resources[prod.res1].isDemanded() ? Number.MAX_SAFE_INTEGER : (100 - resources[prod.res1].storageRatio * 100);
            let res2Weight = resources[prod.res2].isDemanded() ? Number.MAX_SAFE_INTEGER : (100 - resources[prod.res2].storageRatio * 100);

            res2Weight *= settings[`productionExtWeight_${prod.id}`];

            let currentRatio = ExtractorManager.currentProduction(prod.id);
            let newRatio = Math.round(res2Weight / (res1Weight + res2Weight) * 100);

            ExtractorManager.increaseProduction(prod.id, newRatio - currentRatio);
        }
    }

    function autoSmelter() {
        // No smelter; no auto smelter. No soup for you.
        let m = SmelterManager;
        if (!m.initIndustry()) {
            return;
        }

        // Only adjust fuels if race does not have forge trait which means they don't require smelter fuel
        let totalSmelters = m.maxOperating();
        let fuelRemoved = 0;
        if (!game.global.race['forge']) {
            let remainingSmelters = totalSmelters;

            let fuels = m.managedFuelPriorityList();
            let fuelAdjust = {};
            for (let i = 0; i < fuels.length; i++) {
                let fuel = fuels[i];
                if (!fuel.unlocked) {
                    continue;
                }

                let maxAllowedUnits = remainingSmelters;

                // Adjust Inferno to Oil ratio for better efficiency and cost
                if (fuel === m.Fuels.Inferno && fuels[i+1] === m.Fuels.Oil && remainingSmelters > 75) {
                    maxAllowedUnits = Math.floor(0.5 * remainingSmelters + 37.5);
                }

                for (let productionCost of fuel.cost) {
                    let resource = productionCost.resource;
                    // No need to preserve minimum income when storage is full
                    if (resource.storageRatio < 0.8) {
                        let remainingRateOfChange = resource.rateOfChange + (m.fueledCount(fuel) * productionCost.quantity) - productionCost.minRateOfChange;

                        let affordableAmount = Math.max(0, Math.floor(remainingRateOfChange / productionCost.quantity));
                        if (affordableAmount < maxAllowedUnits) {
                            state.tooltips["smelterFuels" + fuel.id.toLowerCase()] = `Too low ${resource.name} income<br>`;
                        }
                        maxAllowedUnits = Math.min(maxAllowedUnits, affordableAmount);
                    }
                }

                remainingSmelters -= maxAllowedUnits;
                fuelAdjust[fuel.id] = maxAllowedUnits - m.fueledCount(fuel);
            }

            for (let fuel of fuels) {
                if (fuelAdjust[fuel.id] < 0) {
                    fuelRemoved += fuelAdjust[fuel.id] * -1;
                    m.decreaseFuel(fuel, fuelAdjust[fuel.id] * -1);
                }
            }

            for (let fuel of fuels) {
                if (fuelAdjust[fuel.id] > 0) {
                    m.increaseFuel(fuel, fuelAdjust[fuel.id]);
                }
            }
            totalSmelters -= remainingSmelters;
        }

        totalSmelters += m.extraOperating();

        let smelterIronCount = m.smeltingCount(m.Productions.Iron);
        let smelterSteelCount = m.smeltingCount(m.Productions.Steel);
        let smelterIridiumCount = m.smeltingCount(m.Productions.Iridium);

        let maxAllowedIridium = m.Productions.Iridium.unlocked && !resources.Iridium.isCapped()
          ? Math.floor(settings.productionSmeltingIridium * totalSmelters) : 0;
        let maxAllowedSteel = totalSmelters - smelterIridiumCount;

        let smeltAdjust = {
            Iridium: maxAllowedIridium - smelterIridiumCount,
            Steel: smelterIridiumCount - maxAllowedIridium,
        };

        // Adjusting fuel can move production from steel to iron, we need to account that
        if (fuelRemoved > smelterIronCount) {
            let steelRemoved = fuelRemoved - smelterIronCount;
            if (steelRemoved <= smelterSteelCount) {
                smeltAdjust.Steel += steelRemoved;
            } else {
                smeltAdjust.Steel += smelterSteelCount;
                smeltAdjust.Iridium += steelRemoved - smelterSteelCount;
            }
        }

        // We only care about steel. It isn't worth doing a full generic calculation here
        // Just assume that smelters will always be fueled so Iron smelting is unlimited
        // We want to work out the maximum steel smelters that we can have based on our resource consumption
        let steelSmeltingConsumption = m.Productions.Steel.cost;
        for (let productionCost of steelSmeltingConsumption) {
            let resource = productionCost.resource;
            // No need to preserve minimum income when storage is full
            if (resource.storageRatio < 0.8) {
                let remainingRateOfChange = resource.rateOfChange + (smelterSteelCount * productionCost.quantity) - productionCost.minRateOfChange;

                let affordableAmount = Math.max(0, Math.floor(remainingRateOfChange / productionCost.quantity));
                if (affordableAmount < maxAllowedSteel) {
                    state.tooltips["smelterMatssteel"] = `Too low ${resource.name} income<br>`;
                }
                maxAllowedSteel = Math.min(maxAllowedSteel, affordableAmount);
            }
        }

        let ironWeighting = 0;
        let steelWeighting = 0;
        switch (settings.productionSmelting){
            case "iron":
                ironWeighting = resources.Iron.timeToFull;
                if (!ironWeighting) {
                    steelWeighting = resources.Steel.timeToFull;
                }
                break;
            case "steel":
                steelWeighting = resources.Steel.timeToFull;
                if (!steelWeighting) {
                    ironWeighting = resources.Iron.timeToFull;
                }
                break;
            case "storage":
                ironWeighting = resources.Iron.timeToFull;
                steelWeighting = resources.Steel.timeToFull;
                break;
            case "required":
                ironWeighting = resources.Iron.timeToRequired;
                steelWeighting = resources.Steel.timeToRequired;
                break;
        }

        if (resources.Iron.isDemanded()) {
            ironWeighting = Number.MAX_SAFE_INTEGER;
        }
        if (resources.Steel.isDemanded()) {
            steelWeighting = Number.MAX_SAFE_INTEGER;
        }
        if (jobs.Miner.count === 0 && buildings.BeltIronShip.stateOnCount === 0) {
            ironWeighting = 0;
            steelWeighting = 1;
            maxAllowedSteel = totalSmelters - smelterIridiumCount;
        }

        // Steel and Iron share a part of maxAllowedSteel.
        let smeltersToSplit = totalSmelters - smelterIridiumCount;
        let baseSteelRatio = ironWeighting > 0 ? steelWeighting / ironWeighting : 1;

        let allowIronSmelting = resources.Iron.storageRatio < 0.99;
        let allowSteelSmelting = (resources.Steel.storageRatio < 0.99) || (resources.Titanium.storageRatio < 0.99 && haveTech("titanium"));

        let newWantedIronCount = 0;
        let newWantedSteelCount = 0;

        // CONFIGURABLES
        let maxSteelRatio = totalSmelters < 10 ? 1.0 : 0.9; // At 0.9, max 90% of non-Iridium smelters can be Steel (10% Iron rounded up)
        let minIron = totalSmelters < 10 ? 0 : 2;
        let maxIron = 10;

        if(allowIronSmelting && allowSteelSmelting) {
            // Split to ratio...
            let usedSteelRatio = baseSteelRatio < maxSteelRatio ? baseSteelRatio : maxSteelRatio;
            newWantedIronCount = Math.ceil((1-usedSteelRatio) * smeltersToSplit);
            newWantedSteelCount = Math.floor(usedSteelRatio * smeltersToSplit);

            // ...now apply min/max iron caps
            if (minIron >= 0 && newWantedIronCount < minIron) {
                // Take from steel
                newWantedSteelCount -= (minIron - newWantedIronCount);
                newWantedIronCount = minIron;
            }
            else if (maxIron >= 0 && newWantedIronCount > maxIron) {
                // Add to steel
                newWantedSteelCount += (newWantedIronCount - maxIron);
                newWantedIronCount = maxIron;
            }
        }
        else if (allowIronSmelting) {
            // All iron
            maxSteelRatio = 0;
            newWantedIronCount = smeltersToSplit;
        }
        else if (allowSteelSmelting) {
            // All steel
            maxSteelRatio = 1;
            newWantedSteelCount = smeltersToSplit;
        }
        else {
            // Leave at 0/0 if nothing allowed
        }

        // Compare to actual smelters.
        smeltAdjust.Iron = newWantedIronCount - smelterIronCount;
        smeltAdjust.Steel = newWantedSteelCount - smelterSteelCount;

        //console.debug("smeltAdjust: %o / baseSteelRatio: %f", smeltAdjust, baseSteelRatio);

        Object.entries(smeltAdjust).forEach(([id, delta]) => delta < 0 && m.decreaseSmelting(id, delta * -1));
        Object.entries(smeltAdjust).forEach(([id, delta]) => delta > 0 && m.increaseSmelting(id, delta));
    }

    function autoFactory() {
        // No factory; no auto factory
        if (!FactoryManager.initIndustry()) {
            return;
        }

        let allProducts = Object.values(FactoryManager.Productions);

        // Init adjustment, and sort groups by priorities
        let priorityGroups = {};
        let factoryAdjustments = {};
        for (let i = 0; i < allProducts.length; i++) {
            let production = allProducts[i];
            state.tooltips["iFactory" + production.id] = `Disabled<br>`;
            if (production.unlocked && production.enabled) {
                if (production.weighting > 0) {
                    let priority = production.resource.isDemanded() ? Math.max(production.priority, 100) : production.priority;
                    if (priority !== 0) {
                        priorityGroups[priority] = priorityGroups[priority] ?? [];
                        priorityGroups[priority].push(production);
                        state.tooltips["iFactory" + production.id] = `Low priority<br>`;
                    }
                }
                factoryAdjustments[production.id] = 0;
            }
        }
        let priorityList = Object.keys(priorityGroups).sort((a, b) => b - a).map(key => priorityGroups[key]);
        if (priorityGroups["-1"] && priorityList.length > 1) {
            priorityList.splice(priorityList.indexOf(priorityGroups["-1"], 1));
            priorityList[0].push(...priorityGroups["-1"]);
        }

        // Calculate amount of factories per product
        let remainingFactories = FactoryManager.maxOperating();
        for (let i = 0; i < priorityList.length && remainingFactories > 0; i++) {
            let products = priorityList[i].sort((a, b) => a.weighting - b.weighting);
            while (remainingFactories > 0) {
                let factoriesToDistribute = remainingFactories;
                let totalPriorityWeight = products.reduce((sum, production) => sum + production.weighting, 0);

                for (let j = products.length - 1; j >= 0 && remainingFactories > 0; j--) {
                    let production = products[j];
                    state.tooltips["iFactory" + production.id] = ``;

                    let calculatedRequiredFactories = Math.min(remainingFactories, Math.max(1, Math.floor(factoriesToDistribute / totalPriorityWeight * production.weighting)));
                    let actualRequiredFactories = calculatedRequiredFactories;

                    if (!production.resource.isUseful()) {
                        actualRequiredFactories = 0;
                        state.tooltips["iFactory" + production.id] += `Resource capped<br>`;
                    }

                    for (let resourceCost of production.cost) {
                        if (!resourceCost.resource.isUnlocked()) {
                            continue;
                        }
                        if (!production.resource.isDemanded()) {
                            if (!settings.useDemanded && resourceCost.resource.isDemanded()) {
                                actualRequiredFactories = 0;
                                state.tooltips["iFactory" + production.id] += `${resourceCost.resource.name} is demanded<br>`;
                                break;
                            }
                            if (resourceCost.resource.storageRatio < settings.productionFactoryMinIngredients) {
                                actualRequiredFactories = 0;
                                state.tooltips["iFactory" + production.id] += `${resourceCost.resource.name} under min materials ratio<br>`;
                                break;
                            }
                        }
                        // No need to preserve minimum income when storage is full
                        if (resourceCost.resource.storageRatio < 0.8){
                            let previousCost = FactoryManager.currentProduction(production) * resourceCost.quantity;
                            let currentCost = factoryAdjustments[production.id] * resourceCost.quantity;
                            let rate = resourceCost.resource.rateOfChange + previousCost - currentCost - resourceCost.minRateOfChange;

                            if (production.resource.isDemanded()) {
                                rate += resourceCost.resource.currentQuantity;
                            }
                            let affordableAmount = Math.floor(rate / resourceCost.quantity);
                            if (affordableAmount < 1) {
                                state.tooltips["iFactory" + production.id] += `Too low ${resourceCost.resource.name} income<br>`;
                            }
                            actualRequiredFactories = Math.min(actualRequiredFactories, affordableAmount);
                        }
                    }

                    // If we're going for bioseed - try to balance neutronium\nanotubes ratio
                    if (settings.prestigeType === "bioseed" && settings.prestigeBioseedConstruct && production === FactoryManager.Productions.NanoTube) {
                        let reservedNeutronium = game.global.race['truepath'] ? 500 : 250;
                        if (resources.Neutronium.currentQuantity < reservedNeutronium) {
                            state.tooltips["iFactory" + production.id] += `${reservedNeutronium} ${resources.Neutronium.name} reserved<br>`;
                            actualRequiredFactories = 0;
                        }
                    }

                    if (actualRequiredFactories > 0){
                        remainingFactories -= actualRequiredFactories;
                        factoryAdjustments[production.id] += actualRequiredFactories;
                    }

                    // We assigned less than wanted, i.e. we either don't need this product, or can't afford it. In both cases - we're done with it.
                    if (actualRequiredFactories < calculatedRequiredFactories) {
                        products.splice(j, 1);
                    }
                }

                if (factoriesToDistribute === remainingFactories) {
                    break;
                }
            }
        }

        // First decrease any production so that we have room to increase others
        for (let production of allProducts) {
            if (factoryAdjustments[production.id] !== undefined) {
                let deltaAdjustments = factoryAdjustments[production.id] - FactoryManager.currentProduction(production);

                if (deltaAdjustments < 0) {
                    FactoryManager.decreaseProduction(production, deltaAdjustments * -1);
                }
            }
        }

        // Increase any production required (if they are 0 then don't do anything with them)
        for (let production of allProducts) {
            if (factoryAdjustments[production.id] !== undefined) {
                let deltaAdjustments = factoryAdjustments[production.id] - FactoryManager.currentProduction(production);

                if (deltaAdjustments > 0) {
                    FactoryManager.increaseProduction(production, deltaAdjustments);
                }
            }
        }
    }

    function autoMiningDroid() {
        // If not unlocked then nothing to do
        if (!DroidManager.initIndustry()) {
            return;
        }

        let allProducts = Object.values(DroidManager.Productions);

        // Init adjustment, and sort groups by priorities
        let priorityGroups = {};
        let factoryAdjustments = {};
        for (let i = 0; i < allProducts.length; i++) {
            let production = allProducts[i];
            if (production.weighting > 0) {
                let priority = production.resource.isDemanded() ? Math.max(production.priority, 100) : production.priority;
                if (priority !== 0) {
                    priorityGroups[priority] = priorityGroups[priority] ?? [];
                    priorityGroups[priority].push(production);
                }
            }
            factoryAdjustments[production.id] = 0;
        }
        let priorityList = Object.keys(priorityGroups).sort((a, b) => b - a).map(key => priorityGroups[key]);
        if (priorityGroups["-1"] && priorityList.length > 1) {
            priorityList.splice(priorityList.indexOf(priorityGroups["-1"], 1));
            priorityList[0].push(...priorityGroups["-1"]);
        }

        // Calculate amount of factories per product
        let remainingFactories = DroidManager.maxOperating();
        for (let i = 0; i < priorityList.length && remainingFactories > 0; i++) {
            let products = priorityList[i].sort((a, b) => a.weighting - b.weighting);
            while (remainingFactories > 0) {
                let factoriesToDistribute = remainingFactories;
                let totalPriorityWeight = products.reduce((sum, production) => sum + production.weighting, 0);

                for (let j = products.length - 1; j >= 0 && remainingFactories > 0; j--) {
                    let production = products[j];

                    let calculatedRequiredFactories = Math.min(remainingFactories, Math.max(1, Math.floor(factoriesToDistribute / totalPriorityWeight * production.weighting)));
                    let actualRequiredFactories = calculatedRequiredFactories;
                    if (!production.resource.isUseful()) {
                        actualRequiredFactories = 0;
                    }

                    if (actualRequiredFactories > 0){
                        remainingFactories -= actualRequiredFactories;
                        factoryAdjustments[production.id] += actualRequiredFactories;
                    }

                    // We assigned less than wanted, i.e. we either don't need this product, or can't afford it. In both cases - we're done with it.
                    if (actualRequiredFactories < calculatedRequiredFactories) {
                        products.splice(j, 1);
                    }
                }

                if (factoriesToDistribute === remainingFactories) {
                    break;
                }
            }
        }
        if (remainingFactories > 0) {
            return;
        }

        // First decrease any production so that we have room to increase others
        for (let production of allProducts) {
            if (factoryAdjustments[production.id] !== undefined) {
                let deltaAdjustments = factoryAdjustments[production.id] - DroidManager.currentProduction(production);

                if (deltaAdjustments < 0) {
                    DroidManager.decreaseProduction(production, deltaAdjustments * -1);
                }
            }
        }

        // Increase any production required (if they are 0 then don't do anything with them)
        for (let production of allProducts) {
            if (factoryAdjustments[production.id] !== undefined) {
                let deltaAdjustments = factoryAdjustments[production.id] - DroidManager.currentProduction(production);

                if (deltaAdjustments > 0) {
                    DroidManager.increaseProduction(production, deltaAdjustments);
                }
            }
        }
    }

    function autoGraphenePlant() {
        // If not unlocked then nothing to do
        if (!GrapheneManager.initIndustry()) {
            return;
        }

        let remainingPlants = GrapheneManager.maxOperating();
        let fuelAdjust = [];

        let sortedFuel = Object.values(GrapheneManager.Fuels).sort((a, b) => b.cost.resource.storageRatio < 0.995 || a.cost.resource.storageRatio < 0.995 ? b.cost.resource.storageRatio - a.cost.resource.storageRatio : b.cost.resource.rateOfChange - a.cost.resource.rateOfChange);
        for (let fuel of sortedFuel) {
            if (remainingPlants === 0) {
                break;
            }

            let resource = fuel.cost.resource;
            if (!resource.isUnlocked()) {
                continue;
            }

            let currentFuelCount = GrapheneManager.fueledCount(fuel);
            let maxFueledForConsumption = remainingPlants;
            if (!resources.Graphene.isUseful()) {
                maxFueledForConsumption = 0;
            } else if (resource.storageRatio < 0.8) {
                let rateOfChange = resource.rateOfChange + fuel.cost.quantity * currentFuelCount - fuel.cost.minRateOfChange;

                let affordableAmount = Math.floor(rateOfChange / fuel.cost.quantity);
                maxFueledForConsumption = Math.max(Math.min(maxFueledForConsumption, affordableAmount), 0);
            }

            let deltaFuel = maxFueledForConsumption - currentFuelCount;
            if (deltaFuel !== 0) {
                fuelAdjust.push({res: fuel, delta: deltaFuel});
            }

            remainingPlants -= currentFuelCount + deltaFuel;
        }

        fuelAdjust.forEach(fuel => fuel.delta < 0 && GrapheneManager.decreaseFuel(fuel.res, fuel.delta * -1));
        fuelAdjust.forEach(fuel => fuel.delta > 0 && GrapheneManager.increaseFuel(fuel.res, fuel.delta));
    }

    // TODO: Allow configuring priorities between eject\supply\nanite
    function autoConsume(m) {
        if (!m.initIndustry()) {
            return;
        }

        let consumeList = m.managedPriorityList();
        let consumeAdjustments = Object.fromEntries(consumeList.map(res => [res.id, 0]));

        if (m.isUseful()) {
            let remaining = m.maxConsume();
            for (let consumeRatio of m.useRatio()) {
                for (let resource of consumeList) {
                    if (remaining <= 0) {
                        break;
                    }

                    // HACK: Force "excess" for Elerium ejecting when in Antimatter
                    // With too much prestige, Elerium storage never fills in AM, making the black hole totally useless
                    // Infernite is too valuable to dump like this (messes with Alien Gift)
                    //  || resource === resources.Infernite
                    if (game.global.race.universe === 'antimatter' && m === EjectManager && (resource === resources.Elerium)) {
                        consumeRatio = -1;
                    }

                    if (!m.resEnabled(resource.id) || resource.isDemanded()) {
                        continue;
                    }

                    let keepRatio = consumeRatio;
                    if (keepRatio === -1) { // Excess resources
                        if (resource.storageRequired <= 1) { // Resource not used, can't determine excess
                            continue;
                        }
                        keepRatio = Math.max(keepRatio, resource.storageRequired / resource.maxQuantity * m.storageShift);
                    }
                    if (resource === resources.Food && !isHungryRace()) { // Preserve food
                        keepRatio = Math.max(keepRatio, 0.25);
                    }
                    keepRatio = Math.max(keepRatio, resource.requestedQuantity / resource.maxQuantity * m.storageShift);

                    let allowedConsume = consumeAdjustments[resource.id];
                    remaining += consumeAdjustments[resource.id];

                    if (resource.isCraftable()) {
                        if (resource.currentQuantity > (resource.storageRequired * m.storageShift)) {
                            let maxConsume = Math.floor(m.maxConsumeCraftable(resource));
                            allowedConsume = Math.max(0, allowedConsume, maxConsume);
                        }
                    } else {
                        if (resource.storageRatio > keepRatio + 0.01) {
                            let maxConsume = Math.ceil(m.maxConsumeForRatio(resource, keepRatio));
                            allowedConsume = Math.max(1, allowedConsume, maxConsume);
                        } else if (resource.storageRatio > keepRatio) {
                            let maxConsume = Math.floor(m.maxConsumeForRatio(resource, keepRatio));
                            allowedConsume = Math.max(0, allowedConsume, maxConsume);
                        } else if (resource.storageRatio >= 0.999 && keepRatio >= 1) {
                            let maxConsume = Math.floor(m.maxConsumeForRatio(resource, resource.storageRatio));
                            allowedConsume = Math.max(0, allowedConsume, maxConsume);
                        }
                    }

                    consumeAdjustments[resource.id] = Math.min(remaining, allowedConsume);
                    remaining -= consumeAdjustments[resource.id];
                }
            }
        }

        Object.keys(consumeAdjustments).forEach((id) => consumeAdjustments[id] -= m.currentConsume(id));
        Object.entries(consumeAdjustments).forEach(([id, delta]) => delta < 0 && m.consumeLess(id, delta * -1));
        Object.entries(consumeAdjustments).forEach(([id, delta]) => delta > 0 && m.consumeMore(id, delta));
    }

    function autoReplicator() {
        // No replicator; no auto autoreplicator
        if (!ReplicatorManager.initIndustry()) {
            return;
        }

        let allProducts = Object.values(ReplicatorManager.Productions);

        // Sort groups by priorities
        let priorityGroups = {};
        for (let i = 0; i < allProducts.length; i++) {
            let production = allProducts[i];
            if (production.unlocked && production.enabled) {
                if (production.weighting > 0) {
                    let priority = production.resource.isDemanded() ? Math.max(production.priority, 100) : production.priority;
                    priority *= !production.resource.isUseful() ? 0 : production.priority;
                    if (priority !== 0) {
                        priorityGroups[priority] = priorityGroups[priority] ?? [];
                        priorityGroups[priority].push(production);
                    }
                }
            }
        }

        let priorityList = Object.keys(priorityGroups).sort((a, b) => b - a).map(key => priorityGroups[key]);
        if (priorityGroups["-1"] && priorityList.length > 1) {
            priorityList.splice(priorityList.indexOf(priorityGroups["-1"], 1));
            priorityList[0].push(...priorityGroups["-1"]);
        }

        // Set the replicator to whatever has 1. the highest priority and 2. the highest weighting. Should be improved in the future
        if (priorityList.length > 0 && priorityList[0].length > 0) {
            var selectedResource = priorityList[0].sort((a, b) => a.weighting - b.weighting)[0];
            ReplicatorManager.setResource(selectedResource.id);
        }


        // Enable matter replicator task

        if (!settings.replicatorAssignGovernorTask) {
            return;
        }

        // Cannot assign if there is no governor, or matter replicator has not been reserached
        if (getGovernor() === "none" || !haveTech("replicator")) {
            return;
        }

        var replicatorTaskIndex = Object.values(game.global.race.governor.tasks).findIndex(task => task === 'replicate');

        // If the replicator task is not yet assigned, assign it to the first free slot
        if (replicatorTaskIndex == -1) {
            replicatorTaskIndex = Object.values(game.global.race.governor.tasks).findIndex(task => task === 'none');

            //No free task slots, cannot assign
            if (replicatorTaskIndex == -1) {
                return;
            }

            getVueById("govOffice").setTask('replicate', replicatorTaskIndex);
        }

        if (game.global.race.governor.config.replicate.pow.on == false) {
            win.document.querySelector('#govOffice .options').getElementsByClassName('tConfig')[8].childNodes[1].childNodes[0].childNodes[0].click() // Enable auto power management
        }
        if (game.global.race.governor.config.replicate.res.que) {
            win.document.querySelector('#govOffice .options').getElementsByClassName('tConfig')[8].childNodes[2].childNodes[0].childNodes[0].click() // Disable focus queue
        }
        if (game.global.race.governor.config.replicate.res.neg) {
            win.document.querySelector('#govOffice .options').getElementsByClassName('tConfig')[8].childNodes[2].childNodes[1].childNodes[0].click() // Disable negative focus
        }
        if (game.global.race.governor.config.replicate.res.cap) {
            win.document.querySelector('#govOffice .options').getElementsByClassName('tConfig')[8].childNodes[2].childNodes[2].childNodes[0].click() // Disable switch on cap
        }
    }

    function formatLogString(logString, replacements) {
        logString = logString.replace(/\{eval:([^}]+)\}/g, (match, evalString) => {
            try {
              return fastEval(evalString);
            } catch(e) {
              return match;
            }
          });

        return logString.replace(/{(\w+)}/g, (placeholderWithDelimiters, placeholderWithoutDelimiters) =>
            replacements.hasOwnProperty(placeholderWithoutDelimiters) ? replacements[placeholderWithoutDelimiters] : placeholderWithDelimiters
        );
    }

    function logPrestige() {
        var placeholders = {};
        placeholders.resetType = prestigeTypes.find(prest => prest.val === settings.prestigeType).label;
        placeholders.timeStamp = game.global.stats.days;
        placeholders.species = game.global.race.species.charAt(0).toUpperCase() + game.global.race.species.slice(1);

        GameLog.logInfo("prestige", formatLogString(settings.log_prestige_format, placeholders), ['achievements']);
    }

    function autoPrestige() {
        switch (settings.prestigeType) {
            case 'none':
                return;
            case 'mad':
                let madVue = getVueById("mad");
                if (madVue?.display && haveTech("mad")) {
                    if (state.goal !== 'Reset') {
                        state.goal = 'Reset';
                        return;
                    }

                    if (madVue.armed) {
                        madVue.arm();
                    }

                    if (!settings.prestigeMADWait || (WarManager.currentSoldiers >= WarManager.maxSoldiers && resources.Population.currentQuantity >= resources.Population.maxQuantity && WarManager.currentSoldiers + resources.Population.currentQuantity >= settings.prestigeMADPopulation)) {
                        state.goal = "GameOverMan";
                        logPrestige();
                        madVue.launch();
                    }
                }
                return;
            case 'bioseed':
                if (isBioseederPrestigeAvailable()) { // Ship completed and probe requirements met
                    if (state.goal !== 'Reset') {
                        state.goal = 'Reset';
                        return;
                    }
                    if (buildings.GasSpaceDockLaunch.isUnlocked()) {
                        buildings.GasSpaceDockLaunch.click();
                    } else if (buildings.GasSpaceDockPrepForLaunch.isUnlocked()) {
                        buildings.GasSpaceDockPrepForLaunch.click();
                    } else {
                        // Open the modal to update the options
                        buildings.GasSpaceDock.cacheOptions();
                    }
                }
                return;
            case 'cataclysm':
                if (isCataclysmPrestigeAvailable()) {
                    if (state.goal !== 'Reset') {
                        state.goal = 'Reset';
                        return;
                    }
                    if (settings.autoEvolution) {
                        loadQueuedSettings(); // Cataclysm doesnt't have evolution stage, so we need to load settings here, before reset
                    }
                    if (techIds["tech-dial_it_to_11"].isClickable()) {
                        logPrestige();
                        techIds["tech-dial_it_to_11"].click();
                    }
                }
                return;
            case 'whitehole':
                if (isWhiteholePrestigeAvailable()) { // Solar mass requirements met and research available
                    if (state.goal !== 'Reset') {
                        state.goal = 'Reset';
                        return;
                    }
                    if (techIds["tech-exotic_infusion"].isUnlocked() && techIds["tech-exotic_infusion"].isAffordable()) {
                        logPrestige();
                    }
                    ["tech-infusion_confirm", "tech-infusion_check", "tech-exotic_infusion"].forEach(id => techIds[id].click());
                }
                return;
            case 'apocalypse':
                if (isApocalypsePrestigeAvailable()) {
                    if (state.goal !== 'Reset') {
                        state.goal = 'Reset';
                        return;
                    }
                    logPrestige();
                    ["tech-protocol66", "tech-protocol66a"].forEach(id => techIds[id].click());
                }
                return;
            case 'ascension':
                if (game.global.race['witch_hunter']) {
                    if (isWitchAscensionPrestigeAvailable()) {
                        if (state.goal !== 'Reset') {
                            state.goal = 'Reset';
                            return;
                        }
                        KeyManager.set(false, false, false);
                        logPrestige();
                        buildings.PitAbsorptionChamber.vue.action(); // Hack to bypass "count < max" check
                        state.goal = "GameOverMan";
                    }
                } else {
                    if (isAscensionPrestigeAvailable()) {
                        if (state.goal !== 'Reset') {
                            state.goal = 'Reset';
                            return;
                        }
                        KeyManager.set(false, false, false);
                        buildings.SiriusAscend.click();
                    }
                }
                return;
            case 'demonic':
                if (game.global.race['witch_hunter']) {
                    if (isWitchAscensionPrestigeAvailable(true)) {
                        if (state.goal !== 'Reset') {
                            state.goal = 'Reset';
                            return;
                        }
                        KeyManager.set(false, false, false);
                        logPrestige();
                        buildings.PitAbsorptionChamber.vue.action(); // Hack to bypass "count < max" check
                        state.goal = "GameOverMan";
                    }
                } else {
                    if (isDemonicPrestigeAvailable()) {
                        if (state.goal !== 'Reset') {
                            state.goal = 'Reset';
                            return;
                        }
                        logPrestige();
                        techIds["tech-demonic_infusion"].click();
                    }
                }
                return;
            case 'terraform':
                if (buildings.RedTerraform.isUnlocked()) {
                    if (state.goal !== 'Reset') {
                        state.goal = 'Reset';
                        return;
                    }
                    KeyManager.set(false, false, false);
                    buildings.RedTerraform.click();
                }
                return;
            case 'matrix':
                if (buildings.TauStarBluePill.isUnlocked()) {
                    if (state.goal !== 'Reset') {
                        state.goal = 'Reset';
                        return;
                    }
                    KeyManager.set(false, false, false);
                    buildings.TauStarBluePill.click();
                }
                return;
            case 'vacuum':
            case 'retire':
            case 'eden':
                // Nothing required, handled externaly
                return;
        }
    }

    function isPrestigeAllowed(type) {
        return settings.autoPrestige && !(settings.prestigeWaitAT && game.global.settings.at > 0) && (!type || settings.prestigeType === type);
    }

    function isCataclysmPrestigeAvailable() {
        return techIds["tech-dial_it_to_11"].isUnlocked();
    }

    function isBioseederPrestigeAvailable() {
        return !isGECKNeeded() && buildings.GasSpaceDock.count >= 1 && buildings.GasSpaceDockShipSegment.count >= 100 && buildings.GasSpaceDockProbe.count >= settings.prestigeBioseedProbes;
    }

    function isWhiteholePrestigeAvailable() {
        return getBlackholeMass() >= settings.prestigeWhiteholeMinMass && (techIds["tech-exotic_infusion"].isUnlocked() || techIds["tech-infusion_check"].isUnlocked() || techIds["tech-infusion_confirm"].isUnlocked());
    }

    function isApocalypsePrestigeAvailable() {
        return techIds["tech-protocol66"].isUnlocked() || techIds["tech-protocol66a"].isUnlocked();
    }

    function isAscensionPrestigeAvailable() {
        return buildings.SiriusAscend.isUnlocked() && isPillarFinished();
    }

    function isWitchAscensionPrestigeAvailable(demonic) {
        return (!demonic || haveTech("forbidden", 5)) && buildings.PitAbsorptionChamber.count >= 100 && buildings.PitSoulCapacitor.instance.energy >= 100000000 && isPillarFinished();
    }

    function isDemonicPrestigeAvailable() {
        return buildings.SpireTower.count > settings.prestigeDemonicFloor && haveTech("waygate", 3) && (!settings.autoMech || (!MechManager.isActive && MechManager.mechsPotential <= settings.prestigeDemonicPotential)) && techIds["tech-demonic_infusion"].isUnlocked();
    }

    function isPillarFinished() {
        let speciesPillarLevel = game.global.pillars[game.global.race.species];
        let canPillar = !speciesPillarLevel && resources.Harmony.currentQuantity >= 1 && game.global.race.universe !== 'micro';
        let canUpgrade = speciesPillarLevel && speciesPillarLevel < game.alevel();
        // Always consider pillared if user doesn't want to wait for pillar, OR can't pillar + can't upgrade existing pillar
        return !settings.prestigeAscensionPillar || (!canPillar && !canUpgrade);
    }

    function isGECKNeeded() {
        return isAchievementUnlocked("lamentis", 5, "standard") && buildings.GasSpaceDockGECK.count < settings.prestigeGECK;
    }

    function getBlackholeMass() {
        let engine = game.global.interstellar.stellar_engine;
        return engine ? engine.mass + engine.exotic : 0;
    }

    function autoShapeshift() {
        if (!game.global.race['shapeshifter'] || settings.shifterGenus === "ignore" || game.global.race.ss_genus === settings.shifterGenus) {
            return false;
        }

        // TODO: Do not imitate own genus.
        getVueById('sshifter')?.setShape(settings.shifterGenus);
    }

    var psychicPowerCost = {
        murder: [10, 8],
        boost: [75, 60],
        assault: [45, 36],
        profit: [65, 52],
        mind_break: [80, 64],
        stun: [100, 80]
    };

    function autoPsychic() {
        if (settings.psychicPower === "none" || !game.global.race['psychic'] || !game.global.tech['psychic'] || resources.Energy.storageRatio < 1) {
            return false;
        }
        let vue = null;
        const canAfford = (p) => resources.Energy.currentQuantity >= psychicPowerCost[p][game.global.tech.psychic >= 5 ? 1 : 0];

        if (settings.psychicPower === "murder" || (settings.psychicPower !== "boost" && game.global.stats.psykill < 10)) {
            if (resources.Population.currentQuantity > 0 && canAfford("murder") && (vue = getVueById('psychicKill'))) {
                vue.murder();
                return; // Always perform 10 murders asap to unlock advanced powers
            }
        }

        if (game.global.tech['psychicthrall'] && game.global.tech['unfathomable'] && game.global.race['unfathomable']) {
            let jailed = resources.Thrall.rateOfChange;
            let cells = resources.Thrall.storageRatio;

            if (settings.psychicPower === "auto" || settings.psychicPower === "mind_break") {
                if ((jailed > 1 || (jailed === 1 && cells === 1)) && canAfford("mind_break") && (vue = getVueById('psychicMindBreak'))) {
                    vue.breakMind();
                    return; // If we have more than one jailed it means that tormenter can't keep up with capture speed for some reason, and need some assistment
                }
            }

            if (settings.psychicPower === "auto" || settings.psychicPower === "stun") {
                if ((game.global.tech.psychicthrall >= 2 && cells < 1) && canAfford("stun") && (vue = getVueById('psychicCapture'))) {
                    vue.stun();
                    return; // That's what we really want, new thrall
                }
            }
        }

        const haveRoom = r => r.currentQuantity + (r.income * 1.5 * 300) < r.maxQuantity;
        let powers = game.global.race.psychicPowers;
        if (settings.psychicPower === "auto" || settings.psychicPower === "profit") {
            if (game.global.tech.psychic >= 3 && haveRoom(resources.Money) && !powers.cash && canAfford("profit") && (vue = getVueById('psychicFinance'))) {
                vue.boostVal();
                return; // More money is always welcomed
            }
        }

        if (settings.psychicPower === "auto" || settings.psychicPower === "boost") {
            if (!powers.boostTime && canAfford("boost")) {
                let boosted = null;
                if (settings.psychicBoostRes === "auto") {
                    let boostable = Object.values(resources).filter(r => r.isUnlocked() && r.atomicMass > 0 && haveRoom(r))
                        .sort((a, b) => b.income - a.income);
                    if (boostable.length > 0) {
                        boosted = boostable[0].id;
                    }
                } else {
                    boosted = settings.psychicBoostRes;
                }

                if (boosted && (vue = getVueById('psychicBoost'))) {
                    $(`#psychicBoost #psyhscrolltarget input[value="${boosted}"]`).click();
                    vue.boostVal();
                    return; // Try to find something that have some good income, and still have a room for more resources
                }
            }
        }

        if (settings.psychicPower === "auto" || settings.psychicPower === "assault") {
            if (game.global.tech.psychic >= 2 && !powers.assaultTime && canAfford("assault") && (vue = getVueById('psychicAssault'))) {
                vue.boostVal();
                return; // Very last option, attack boost
            }
        }
    }

    function autoGenetics() {
        let genetics = game.global.tech.genetics;
        if (!genetics) {
            return; // Genetics not researched yet
        }

        let geneticsVue = getVueById("arpaSequence");
        let seq = game.global.arpa.sequence;
        if (!geneticsVue || !seq) {
            return; // Just in case
        }

        if ((settings.geneticsSequence === "enabled" && !seq.on) ||
            (settings.geneticsSequence === "disabled" && seq.on) ||
            (settings.geneticsSequence === "decode" && seq.on && genetics > 1)) {
            geneticsVue.toggle();
        }

        if (genetics < 5) {
            return; // Boost not researched yet
        }

        if ((settings.geneticsBoost === "enabled" && !seq.boost) ||
            (settings.geneticsBoost === "disabled" && seq.boost)) {
            geneticsVue.booster();
        }

        if (genetics < 6) {
            return; // Assembling not researched yet
        }

        if ((settings.geneticsAssemble === "enabled" && !seq.auto) ||
            (settings.geneticsAssemble === "disabled" && seq.auto)) {
            geneticsVue.auto_seq();
        }

        if (settings.geneticsAssemble !== "auto" || resources.Knowledge.currentQuantity < 200000 || resources.Knowledge.isDemanded()) {
            return; // Auto assembling disabled, knowledge is too low, or demanded
        }

        let nextTickKnowledge = resources.Knowledge.currentQuantity + resources.Knowledge.rateOfChange / ticksPerSecond();
        let overflowKnowledge = nextTickKnowledge - resources.Knowledge.maxQuantity;
        if (overflowKnowledge <= 0) {
            return; // No overflow yet, we can wait untill next script tick
        }

        let genesToAssemble = Math.ceil(overflowKnowledge / 200000);
        resources.Knowledge.currentQuantity -= 200000 * genesToAssemble;
        resources.Genes.currentQuantity += 1 * genesToAssemble;

        for (let m of KeyManager.click(genesToAssemble)) {
            geneticsVue.novo();
        }
    }

    function autoMarket(bulkSell, ignoreSellRatio) {
        if (!MarketManager.isUnlocked()) {
            return;
        }

        adjustTradeRoutes();

        // Manual trade disabled
        if (game.global.race['no_trade']) {
            return;
        }

        let minimumMoneyAllowed = Math.max(resources.Money.maxQuantity * settings.minimumMoneyPercentage / 100, settings.minimumMoney);

        let currentMultiplier = MarketManager.multiplier; // Save the current multiplier so we can reset it at the end of the function
        let maxMultiplier = MarketManager.getMaxMultiplier();

        for (let i = 0; i < MarketManager.priorityList.length; i++) {
            let resource = MarketManager.priorityList[i];

            if (!resource.is.tradable || !resource.isUnlocked() || !MarketManager.isBuySellUnlocked(resource)) {
                continue;
            }

            if (resource.autoSellEnabled && (ignoreSellRatio || resource.storageRatio >= resource.autoSellRatio)) {
                let maxAllowedTotalSellPrice = resources.Money.maxQuantity - resources.Money.currentQuantity;
                let unitSellPrice = MarketManager.getUnitSellPrice(resource);
                let maxAllowedUnits = Math.floor(maxAllowedTotalSellPrice / unitSellPrice); // only sell up to our maximum money

                if (resource.storageRatio > resource.autoSellRatio) {
                    maxAllowedUnits = Math.min(maxAllowedUnits, Math.floor(resource.currentQuantity - (resource.autoSellRatio * resource.maxQuantity))); // If not full sell up to our sell ratio
                } else {
                    maxAllowedUnits = Math.min(maxAllowedUnits, Math.floor(resource.income * 2 / ticksPerSecond())); // If resource is full then sell up to 2 ticks worth of production
                }

                if (maxAllowedUnits <= maxMultiplier) {
                    // Our current max multiplier covers the full amount that we want to sell
                    MarketManager.setMultiplier(maxAllowedUnits);
                    MarketManager.sell(resource);
                } else {
                    // Our current max multiplier doesn't cover the full amount that we want to sell. Sell up to 5 batches.
                    let counter = Math.min(5, Math.floor(maxAllowedUnits / maxMultiplier)); // Allow up to 5 sales per script loop
                    MarketManager.setMultiplier(maxMultiplier);

                    for (let j = 0; j < counter; j++) {
                        MarketManager.sell(resource);
                    }
                }
            }

            if (bulkSell === true) {
                continue;
            }

            if (resource.autoBuyEnabled === true && resource.storageRatio < resource.autoBuyRatio && !resources.Money.isDemanded()) {
                let storableAmount = Math.floor((resource.autoBuyRatio - resource.storageRatio) * resource.maxQuantity);
                let affordableAmount = Math.floor((resources.Money.currentQuantity - minimumMoneyAllowed) / MarketManager.getUnitBuyPrice(resource));
                let maxAllowedUnits = Math.min(storableAmount, affordableAmount);
                if (maxAllowedUnits > 0) {
                    if (maxAllowedUnits <= maxMultiplier){
                        MarketManager.setMultiplier(maxAllowedUnits);
                        MarketManager.buy(resource);
                    } else {
                        let counter = Math.min(5, Math.floor(maxAllowedUnits / maxMultiplier));
                        MarketManager.setMultiplier(maxMultiplier);

                        for (let j = 0; j < counter; j++) {
                            MarketManager.buy(resource);
                        }
                    }
                }
            }
        }

        MarketManager.setMultiplier(currentMultiplier); // Reset multiplier
    }

    function autoGalaxyMarket() {
        // If not unlocked then nothing to do
        if (!GalaxyTradeManager.initIndustry()) {
            return;
        }

         // Init adjustment, and sort groups by priorities
        let priorityGroups = {};
        let tradeAdjustments = {};
        for (let i = 0; i < poly.galaxyOffers.length; i++) {
            let trade = poly.galaxyOffers[i];
            let buyResource = resources[trade.buy.res];
            if (buyResource.galaxyMarketWeighting > 0) {
                let priority = buyResource.isDemanded() ? Math.max(buyResource.galaxyMarketPriority, 100) : buyResource.galaxyMarketPriority;
                if (priority !== 0) {
                    priorityGroups[priority] = priorityGroups[priority] ?? [];
                    priorityGroups[priority].push(trade);
                }
            }
            tradeAdjustments[buyResource.id] = 0;
        }
        let priorityList = Object.keys(priorityGroups).sort((a, b) => b - a).map(key => priorityGroups[key]);
        if (priorityGroups["-1"] && priorityList.length > 1) {
            priorityList.splice(priorityList.indexOf(priorityGroups["-1"], 1));
            priorityList[0].push(...priorityGroups["-1"]);
        }

        // Calculate amount of factories per product
        let remainingFreighters = GalaxyTradeManager.maxOperating();
        for (let i = 0; i < priorityList.length && remainingFreighters > 0; i++) {
            let trades = priorityList[i].sort((a, b) => resources[a.buy.res].galaxyMarketWeighting - resources[b.buy.res].galaxyMarketWeighting);
            while (remainingFreighters > 0) {
                let freightersToDistribute = remainingFreighters;
                let totalPriorityWeight = trades.reduce((sum, trade) => sum + resources[trade.buy.res].galaxyMarketWeighting, 0);

                for (let j = trades.length - 1; j >= 0 && remainingFreighters > 0; j--) {
                    let trade = trades[j];
                    let buyResource = resources[trade.buy.res];
                    let sellResource = resources[trade.sell.res];

                    let calculatedRequiredFreighters = Math.min(remainingFreighters, Math.max(1, Math.floor(freightersToDistribute / totalPriorityWeight * buyResource.galaxyMarketWeighting)));
                    let actualRequiredFreighters = calculatedRequiredFreighters;
                    if (!buyResource.isUseful() || sellResource.isDemanded() || sellResource.storageRatio < settings.marketMinIngredients) {
                        actualRequiredFreighters = 0;
                    }

                    if (actualRequiredFreighters > 0){
                        remainingFreighters -= actualRequiredFreighters;
                        tradeAdjustments[buyResource.id] += actualRequiredFreighters;
                    }

                    // We assigned less than wanted, i.e. we either don't need this product, or can't afford it. In both cases - we're done with it.
                    if (actualRequiredFreighters < calculatedRequiredFreighters) {
                        trades.splice(j, 1);
                    }
                }

                if (freightersToDistribute === remainingFreighters) {
                    break;
                }
            }
        }

        let tradeDeltas = poly.galaxyOffers.map((trade, index) => tradeAdjustments[trade.buy.res] - GalaxyTradeManager.currentProduction(index));

        // TODO: Add GalaxyTradeManager.zeroProduction() to save some clicks.
        tradeDeltas.forEach((value, index) => value < 0 && GalaxyTradeManager.decreaseProduction(index, value * -1));
        tradeDeltas.forEach((value, index) => value > 0 && GalaxyTradeManager.increaseProduction(index, value));
    }

    function autoGatherResources() {
        // Don't spam click once we've got a bit of population going
        if (!settings.buildingAlwaysClick && resources.Population.currentQuantity > 15 && (buildings.RockQuarry.count > 0 || game.global.race['sappy'])) {
            return;
        }

        // Uses exposed action handlers, bypassing vue - they much faster, and that's important with a lot of calls
        let resPerClick = getResourcesPerClick();
        let amount = 0;
        if (buildings.Food.isClickable()){
            if (haveTech("conjuring", 1)) {
                amount = Math.floor(Math.min((resources.Food.maxQuantity - resources.Food.currentQuantity) / (resPerClick * 10), resources.Mana.currentQuantity, settings.buildingClickPerTick));
                resources.Mana.currentQuantity -= amount;
                resources.Food.currentQuantity += amount * resPerClick;
            } else {
                amount = Math.ceil(Math.min((resources.Food.maxQuantity - resources.Food.currentQuantity) / resPerClick, settings.buildingClickPerTick));
                resources.Food.currentQuantity = Math.min(resources.Food.currentQuantity + amount * resPerClick, resources.Food.maxQuantity);
            }
            let food = game.actions.city.food;
            for (let i = 0; i < amount; i++) {
                food.action();
            }
        }
        if (buildings.Lumber.isClickable()){
            if (haveTech("conjuring", 2)) {
                amount = Math.floor(Math.min((resources.Lumber.maxQuantity - resources.Lumber.currentQuantity) / (resPerClick * 10), resources.Mana.currentQuantity, settings.buildingClickPerTick));
                resources.Mana.currentQuantity -= amount;
                resources.Lumber.currentQuantity += amount * resPerClick;
            } else {
                amount = Math.ceil(Math.min((resources.Lumber.maxQuantity - resources.Lumber.currentQuantity) / resPerClick, settings.buildingClickPerTick));
                resources.Lumber.currentQuantity = Math.min(resources.Lumber.currentQuantity + amount * resPerClick, resources.Lumber.maxQuantity);
            }
            let lumber = game.actions.city.lumber;
            for (let i = 0; i < amount; i++) {
                lumber.action();
            }
        }
        if (buildings.Stone.isClickable()){
            if (haveTech("conjuring", 2)) {
                amount = Math.floor(Math.min((resources.Stone.maxQuantity - resources.Stone.currentQuantity) / (resPerClick * 10), resources.Mana.currentQuantity, settings.buildingClickPerTick));
                resources.Mana.currentQuantity -= amount;
                resources.Stone.currentQuantity += amount * resPerClick;
            } else {
                amount = Math.ceil(Math.min((resources.Stone.maxQuantity - resources.Stone.currentQuantity) / resPerClick, settings.buildingClickPerTick));
                resources.Stone.currentQuantity = Math.min(resources.Stone.currentQuantity + amount * resPerClick, resources.Stone.maxQuantity);
            }
            let stone = game.actions.city.stone;
            for (let i = 0; i < amount; i++) {
                stone.action();
            }
        }
        if (buildings.Chrysotile.isClickable()){
            if (haveTech("conjuring", 2)) {
                amount = Math.floor(Math.min((resources.Chrysotile.maxQuantity - resources.Chrysotile.currentQuantity) / (resPerClick * 10), resources.Mana.currentQuantity, settings.buildingClickPerTick));
                resources.Mana.currentQuantity -= amount;
                resources.Chrysotile.currentQuantity += amount * resPerClick;
            } else {
                amount = Math.ceil(Math.min((resources.Chrysotile.maxQuantity - resources.Chrysotile.currentQuantity) / resPerClick, settings.buildingClickPerTick));
                resources.Chrysotile.currentQuantity = Math.min(resources.Chrysotile.currentQuantity + amount * resPerClick, resources.Chrysotile.maxQuantity);
            }
            let chrysotile = game.actions.city.chrysotile;
            for (let i = 0; i < amount; i++) {
                chrysotile.action();
            }
        }
        if (buildings.Slaughter.isClickable()){
            amount = Math.min(Math.max(resources.Lumber.maxQuantity - resources.Lumber.currentQuantity, resources.Food.maxQuantity - resources.Food.currentQuantity, resources.Furs.maxQuantity - resources.Furs.currentQuantity) / resPerClick, settings.buildingClickPerTick);
            let slaughter = game.actions.city.slaughter;
            for (let i = 0; i < amount; i++) {
                slaughter.action();
            }
            resources.Lumber.currentQuantity = Math.min(resources.Lumber.currentQuantity + amount * resPerClick, resources.Lumber.maxQuantity);
            if (game.global.race['soul_eater'] && haveTech("primitive")){
                resources.Food.currentQuantity = Math.min(resources.Food.currentQuantity + amount * resPerClick, resources.Food.maxQuantity);
            }
            if (resources.Furs.isUnlocked()) {
                resources.Furs.currentQuantity = Math.min(resources.Furs.currentQuantity + amount * resPerClick, resources.Furs.maxQuantity);
            }
        }
    }

    function autoBuild() {
        BuildingManager.updateWeighting();
        ProjectManager.updateWeighting();

        let ignoredList = [...state.queuedTargets, ...state.triggerTargets];
        let buildingList = [...BuildingManager.managedPriorityList(), ...ProjectManager.managedPriorityList()];

        // Sort array so we'll have prioritized buildings on top. We'll need that below to avoid deathlocks, when building 1 waits for building 2, and building 2 waits for building 3. That's something we don't want to happen when building 1 and building 3 doesn't conflicts with each other.
        state.unlockedBuildings = buildingList.sort((a, b) => b.weighting - a.weighting);

        let estimatedTime = {};
        let affordableCache = {};
        const isAffordable = (building) => (affordableCache[building._vueBinding] ?? (affordableCache[building._vueBinding] = building.isAffordable()));

        // Loop through the auto build list and try to buy them
        buildingsLoop:
        for (let i = 0; i < buildingList.length; i++) {
            let building = buildingList[i];

            // Only go further if it's affordable building, and not current target
            if (ignoredList.includes(building) || !isAffordable(building)) {
                continue;
            }

            // Check queue and trigger conflicts
            let conflict = getCostConflict(building);
            if (conflict) {
                building.extraDescription += `Conflicts with ${conflict.actionList.map(action => {return `<span class="has-text-info">${action}</span>`;}).join(', ')} for ${conflict.resList.map(res => {return `<span class="has-text-info">${res}</span>`;}).join(', ')} (${conflict.obj.cause})<br>`;
                continue;
            }

            // Checks weights, if this building doesn't demands any overflowing resources(unless we ignoring overflowing)
            if (!settings.buildingBuildIfStorageFull || !Object.keys(building.cost).some(res => resources[res].storageRatio > 0.98)) {
                for (let j = 0; j < buildingList.length; j++) {
                    let other = buildingList[j];
                    let weightDiffRatio = other.weighting / building.weighting;

                    // Buildings sorted by weighting, so once we reached something with lower weighting - all remaining also lower, and we don't care about them
                    if (weightDiffRatio <= 1.000001) {
                        break;
                    }
                    // And we don't want to process clickable buildings - all buildings with highter weighting should already been proccessed.
                    // If that thing is affordable, but wasn't bought - it means something block it, and it won't be builded soon anyway, so we'll ignore it's demands.
                    // Unless that thing have x10 weight, and we absolutely don't want to waste its resources
                    if (weightDiffRatio < 10 && isAffordable(other)){
                        continue;
                    }

                    // Calculate time to build for competing building, if it's not cached
                    let estimation = estimatedTime[other._vueBinding];
                    if (!estimation){
                        estimation = [];

                        for (let res in other.cost) {
                            let resource = resources[res];
                            let quantity = other.cost[res];

                            // Ignore locked
                            if (!resource.isUnlocked()) {
                                continue;
                            }

                            let totalRateOfCharge = resource.rateOfChange;
                            if (totalRateOfCharge > 0) {
                                estimation[resource.id] = (quantity - resource.currentQuantity) / totalRateOfCharge;
                            } else if (settings.buildingsIgnoreZeroRate && resource.storageRatio < 0.975 && resource.currentQuantity < quantity) {
                                estimation[resource.id] = Number.MAX_SAFE_INTEGER;
                            } else {
                                // Craftables and such, which not producing at this moment. We can't realistically calculate how much time it'll take to fulfil requirement(too many factors), so let's assume we can get it any any moment.
                                estimation[resource.id] = 0;
                            }
                        }
                        estimation.total = Math.max(0, ...Object.values(estimation));
                        estimatedTime[other._vueBinding] = estimation;
                    }

                    // Compare resource costs
                    for (let res in building.cost) {
                        let resource = resources[res];
                        let thisQuantity = building.cost[res];

                        // Ignore locked and capped resources
                        if (!resource.isUnlocked() || (resource.storageRatio > 0.99 && resource.currentQuantity >= resource.storageRequired)){
                            continue;
                        }

                        // Check if we're actually conflicting on this resource
                        let otherQuantity = other.cost[res];
                        if (otherQuantity === undefined){
                            continue;
                        }

                        // We have enought resources for both buildings, no need to preserve it
                        if (resource.currentQuantity >= (otherQuantity + thisQuantity)) {
                            continue;
                        }

                        // We can use up to this amount of resources without delaying competing building
                        // Not very accurate, as income can fluctuate wildly for foundry, factory, and such, but should work as bottom line
                        if (thisQuantity <= (estimation.total - estimation[resource.id]) * resource.rateOfChange) {
                            continue;
                        }

                        // Check if cost difference is below weighting threshold, so we won't wait hours for 10x amount of resources when weight is just twice higher
                        let costDiffRatio = otherQuantity / thisQuantity;
                        if (costDiffRatio >= weightDiffRatio) {
                            continue;
                        }

                        // If we reached here - then we want to delay with our current building. Return all way back to main loop, and try to build something else
                        building.extraDescription += `Conflicts with ${other.title} for <span class="has-text-info">${resource.name}</span><br>`;
                        continue buildingsLoop;
                    }
                }
            }

            // Build building
            if (building.click()) {
                // Only one building with consumption per tick, so we won't build few red buildings having just 1 extra support, and such
                // Same for gems when we're saving them, and missions as they tends to unlock new stuff
                // TODO: Allow build things with different consumtions
                if (building.consumption.length > 0 || building.isMission() || (building.cost["Soul_Gem"] && settings.prestigeType === "whitehole" && settings.prestigeWhiteholeSaveGems)) {
                    return;
                }
                // Mark all processed building as unaffordable for remaining loop, so they won't appear as conflicting
                for (let key in affordableCache) {
                    affordableCache[key] = false;
                }
            }
        }
    }

    function getTechConflict(tech) {
        let itemId = tech._vueBinding;

        // Skip ignored techs
        if (settings.researchIgnore.includes(itemId)) {
            return "Ignored research";
        }

        // Save soul gems for reset
        if (settings.prestigeType === "whitehole" && settings.prestigeWhiteholeSaveGems && itemId !== "tech-virtual_reality" &&
            tech.cost["Soul_Gem"] > resources.Soul_Gem.currentQuantity - 10) {
            return "Saving up Soul Gems for prestige";
        }

        // Don't click any reset options without user consent... that would be a dick move, man.
        if (itemId === "tech-exotic_infusion" || itemId === "tech-infusion_check" || itemId === "tech-infusion_confirm" ||
            itemId === "tech-dial_it_to_11" || itemId === "tech-limit_collider" || itemId === "tech-demonic_infusion" ||
            itemId === "tech-protocol66" || itemId === "tech-protocol66a") {
            return "Reset research";
        }

        if (itemId === "tech-isolation_protocol" && settings.prestigeType !== "retire") {
            return "Progression fork to Retirement reset";
        }

        if (itemId === "tech-outerplane_summon" && settings.prestigeType !== "demonic") {
            return "Progression fork to Witch Hunter's Demonic Infusion";
        }

        if (itemId === "tech-focus_cure" && settings.prestigeType !== "matrix") {
            return "Progression fork to Matrix reset";
        }

        if ((itemId === "tech-vax_strat1" || itemId === "tech-vax_strat2" || itemId === "tech-vax_strat3" || itemId === "tech-vax_strat4") && !itemId.includes(settings.prestigeVaxStrat)) {
            return "Undesirable Vaccination Strategy";
        }

        // Don't use Dark Bomb if not enabled
        if (itemId === "tech-dark_bomb" && (!settings.prestigeDemonicBomb || settings.prestigeType !== "infusion")) {
            return "Dark Bomb disabled";
        }

        // Don't waste phage and plasmid on ascension techs if we're not going there
        if ((itemId === "tech-incorporeal" || itemId === "tech-tech_ascension") && settings.prestigeType !== "ascension") {
            return "Not needed for current prestige";
        }

        // Alien Gift
        if (itemId === "tech-xeno_gift" && resources.Knowledge.maxQuantity < settings.fleetAlienGiftKnowledge) {
            return `${getNumberString(settings.fleetAlienGiftKnowledge)} Max Knowledge required`;
        }

        // Unification
        if ((itemId === "tech-unification2" || itemId === "tech-unite") && !settings.foreignUnification) {
            return "Unification disabled";
        }

        // If user wants to stabilize blackhole then do it, unless we're on blackhole run
        if (itemId === "tech-stabilize_blackhole") {
            if (!settings.prestigeWhiteholeStabiliseMass) {
                return "Blackhole stabilization disabled";
            }
            if (settings.prestigeType === "whitehole") {
                return "Disabled during whilehole reset";
            }
        }

        if (itemId !== settings.userResearchTheology_1 && (itemId === "tech-anthropology" || itemId === "tech-fanaticism")) {
            const isFanatRace = () => Object.values(fanatAchievements).reduce((result, combo) => result || (game.global.race.species === combo.race && game.global.race.gods === combo.god && !isAchievementUnlocked(combo.achieve, game.alevel())), false);
            if (itemId === "tech-anthropology" && !(settings.userResearchTheology_1 === "auto" && settings.prestigeType === "mad" && !isFanatRace())) {
                return "Undesirable theology path";
            }
            if (itemId === "tech-fanaticism" && !(settings.userResearchTheology_1 === "auto" && (settings.prestigeType !== "mad" || isFanatRace()))) {
                return "Undesirable theology path";
            }
        }

        if (itemId !== settings.userResearchTheology_2 && (itemId === "tech-deify" || itemId === "tech-study")) {
            let longRun = ["ascension", "demonic", "apocalypse", "terraform", "matrix", "retire", "eden"].includes(settings.prestigeType);
            if (itemId === "tech-deify" && !(settings.userResearchTheology_2 === "auto" && longRun)) {
                return "Undesirable theology path";
            }
            if (itemId === "tech-study" && !(settings.userResearchTheology_2 === "auto" && !longRun)) {
                return "Undesirable theology path";
            }
        }
        return false;
    }

    function autoTrigger() {
        let triggerActive = false;
        for (let trigger of state.triggerTargets) {
            if (trigger.click()) {
                triggerActive = true;
            }
        }
        return triggerActive;
    }

    function autoResearch() {
        for (let tech of state.unlockedTechs) {
            if (tech.isAffordable() && !getCostConflict(tech) && tech.click()) {
                BuildingManager.updateBuildings(); // Cache cost if we just unlocked some building
                ProjectManager.updateProjects();
                return;
            }
        }
    }

    function getCitadelConsumption(amount) {
        return (30 + (amount - 1) * 2.5) * amount * (game.global.race['emfield'] ? 1.5 : 1);
    }

    function isHellSupressUseful() {
        return jobs.Archaeologist.count > 0 || crafter.Scarletite.count > 0 || buildings.RuinsArcology.stateOnCount > 0 || buildings.GateInferniteMine.stateOnCount > 0;
    }

    function autoPower() {
        // Only start doing this once power becomes available. Isn't useful before then
        if (!resources.Power.isUnlocked()) {
            return;
        }

        let buildingList = BuildingManager.managedStatePriorityList();

        // No buildings unlocked yet
        if (buildingList.length === 0) {
            return;
        }

        // Calculate the available power / resource rates of change that we have to work with
        let availablePower = resources.Power.currentQuantity;

        for (let i = 0; i < buildingList.length; i++) {
            let building = buildingList[i];

            availablePower += (building.powered * building.stateOnCount);

            for (let j = 0; j < building.consumption.length; j++) {
                let resourceType = building.consumption[j];

                // Just like for power, get our total resources available
                if (building === buildings.BeltSpaceStation && resourceType.resource === resources.Belt_Support) {
                    resources.Belt_Support.rateOfChange -= resources.Belt_Support.maxQuantity;
                } else {
                    resourceType.resource.rateOfChange += building.getFuelRate(j) * building.stateOnCount;
                }
            }
        }

        let manageTransport = buildings.LakeTransport.isSmartManaged() && buildings.LakeBireme.isSmartManaged();
        let manageSpire = buildings.SpirePort.isSmartManaged() && buildings.SpireBaseCamp.isSmartManaged();
        // Mining pit has seperate smart behavior so only check Colony for this.
        // Materials phase is active at tauceti 1-3, ended by building both jump gate sides and having the game grant tauceti 4
        let manageTauCetiMaterials = buildings.TauColony.isSmartManaged() && game.global.tech.tauceti && game.global.tech.tauceti <= 4;

        // Start assigning buildings from the top of our priority list to the bottom
        for (let i = 0; i < buildingList.length; i++) {
            let building = buildingList[i];
            let maxStateOn = building.count;
            let currentStateOn = building.stateOnCount;

            if (!game.global.settings.showGalactic && building._tab === "galaxy") {
                maxStateOn = 0;
            }
            if (settings.buildingsLimitPowered) {
                maxStateOn = Math.min(maxStateOn, building.autoMax);
            }

            // Max powered amount
            if (building === buildings.NeutronCitadel) {
                while (maxStateOn > 0) {
                    if (availablePower >= getCitadelConsumption(maxStateOn)) {
                        break;
                    } else {
                        maxStateOn--;
                    }
                }
            } else if (building.powered > 0) {
                maxStateOn = Math.min(maxStateOn, availablePower / building.powered);
            }

            // Ascension Machine and Terraformer missing energy
            if ((building === buildings.SiriusAscensionTrigger || building === buildings.RedAtmoTerraformer) && availablePower < building.powered) {
                building.extraDescription = `Missing ${Math.ceil(building.powered - availablePower)} MW to power on<br>${building.extraDescription}`;
            }

            // Spire managed separately
            if (manageSpire && (building === buildings.SpirePort || building === buildings.SpireBaseCamp || building === buildings.SpireMechBay)) {
                continue;
            }
            // Lake transport managed separately
            if (manageTransport && (building === buildings.LakeTransport || building === buildings.LakeBireme)) {
                continue;
            }
            // Tau Ceti materials managed separately
            if (manageTauCetiMaterials && (building === buildings.TauColony || building === buildings.TauMiningPit)) {
                continue;
            }
            if (building.is.smart && building.autoStateSmart) {
                if (resources.Power.currentQuantity <= resources.Power.maxQuantity || haveTech('replicator')) { // Saving power, unless we can afford everything
                    // Disable Belt Space Stations with no workers
                    if (building === buildings.BeltSpaceStation && game.breakdown.c.Elerium) {
                        let stationStorage = parseFloat(game.breakdown.c.Elerium[game.loc("space_belt_station_title")] ?? 0);
                        let extraStations = Math.floor((resources.Elerium.maxQuantity - resources.Elerium.maxCost) / stationStorage);
                        let minersNeeded = buildings.BeltEleriumShip.stateOnCount * 2 + buildings.BeltIridiumShip.stateOnCount + buildings.BeltIronShip.stateOnCount;
                        maxStateOn = Math.min(maxStateOn, Math.max(currentStateOn - extraStations, Math.ceil(minersNeeded / 3)));
                    }
                    if (building === buildings.CementPlant && jobs.CementWorker.count === 0) {
                        maxStateOn = 0;
                    }
                    if (building === buildings.Mine && jobs.Miner.count === 0) {
                        maxStateOn = 0;
                    }
                    if (building === buildings.CoalMine && jobs.CoalMiner.count === 0) {
                        maxStateOn = 0;
                    }
                    // Enable cooling towers only if we can power at least two harbours
                    if (building === buildings.LakeCoolingTower && availablePower < (building.powered * maxStateOn + ((500 * 0.92 ** maxStateOn) * (game.global.race['emfield'] ? 1.5 : 1)).toFixed(2) * Math.min(2, buildings.LakeHarbour.count))) {
                        maxStateOn = 0;
                    }
                    // Don't bother powering harbour if we have power for only one
                    if (building === buildings.LakeHarbour && maxStateOn === 1 && building.count > 1) {
                        maxStateOn = 0;
                    }
                    if (building === buildings.GasMining && !resources.Helium_3.isUseful()) {
                        maxStateOn = Math.min(maxStateOn, resources.Helium_3.getBusyWorkers("space_gas_mining_title", currentStateOn));
                        if (maxStateOn !== currentStateOn) {
                            resources.Helium_3.incomeAdusted = true;
                        }
                    }
                    if (building === buildings.GasMoonOilExtractor  && !resources.Oil.isUseful()) {
                        maxStateOn = Math.min(maxStateOn, resources.Oil.getBusyWorkers("space_gas_moon_oil_extractor_title", currentStateOn));
                        if (maxStateOn !== currentStateOn) {
                            resources.Oil.incomeAdusted = true;
                        }
                    }
                    // Kuiper Mines
                    // TODO: Disable with 100% syndicate
                    if (building === buildings.KuiperOrichalcum && !resources.Orichalcum.isUseful()) {
                        maxStateOn = Math.min(maxStateOn, resources.Orichalcum.getBusyWorkers("space_kuiper_mine", currentStateOn, [resources.Orichalcum.title]));
                        if (maxStateOn !== currentStateOn) {
                            resources.Orichalcum.incomeAdusted = true;
                        }
                    }
                    if (building === buildings.KuiperUranium && !resources.Uranium.isUseful()) {
                        maxStateOn = Math.min(maxStateOn, resources.Uranium.getBusyWorkers("space_kuiper_mine", currentStateOn, [resources.Uranium.title]));
                        if (maxStateOn !== currentStateOn) {
                            resources.Uranium.incomeAdusted = true;
                        }
                    }
                    if (building === buildings.KuiperNeutronium && !resources.Neutronium.isUseful()) {
                        maxStateOn = Math.min(maxStateOn, resources.Neutronium.getBusyWorkers("space_kuiper_mine", currentStateOn, [resources.Neutronium.title]));
                        if (maxStateOn !== currentStateOn) {
                            resources.Neutronium.incomeAdusted = true;
                        }
                    }
                    if (building === buildings.KuiperElerium && !resources.Elerium.isUseful()) {
                        maxStateOn = Math.min(maxStateOn, resources.Elerium.getBusyWorkers("space_kuiper_mine", currentStateOn, [resources.Elerium.title]));
                        if (maxStateOn !== currentStateOn) {
                            resources.Elerium.incomeAdusted = true;
                        }
                    }
                }
                // Limit lander to sustainable amount
                if (building === buildings.TritonLander) {
                    if (buildings.TritonFOB.stateOnCount < 1) { // Does not work with no FOB
                        maxStateOn = 0;
                    } else {
                        //let protectedSoldiers = (game.global.race['armored'] ? 1 : 0) + (game.global.race['scales'] ? 1 : 0) + (game.global.tech['armor'] ?? 0);
                        //let woundCap = Math.ceil((game.global.space.fob.enemy + (game.global.tech.outer >= 4 ? 75 : 62.5)) / 5) - protectedSoldiers;
                        //let maxLanders = getHealingRate() < woundCap ? Math.floor((getHealingRate() + protectedSoldiers) / 1.5) : Number.MAX_SAFE_INTEGER;
                        let reservedSoldiers = settings.autoFleet ? FleetManagerOuter.nextShipDesiredCrew : 0;
                        let healthySquads = Math.floor((WarManager.currentSoldiers - WarManager.wounded - reservedSoldiers) / (3 * traitVal('high_pop', 0, 1)));
                        maxStateOn = Math.min(maxStateOn, healthySquads /*, maxLanders*/ );
                    }
                }
                // Do not enable Ascension Machine while we're waiting for pillar
                if (building === buildings.SiriusAscensionTrigger && (!isPillarFinished() || settings.prestigeType !== 'ascension')) {
                    maxStateOn = 0;
                }
                if (building === buildings.RedAtmoTerraformer && settings.prestigeType !== 'terraform') {
                    maxStateOn = 0;
                }
                // Determine the number of powered attractors
                // The goal is to keep threat in the desired range
                // If threat is larger than the configured top value, turn all attractors off
                // If threat is lower than the bottom value, turn all attractors on
                // Linear in between
                if (building === buildings.BadlandsAttractor) {
                    let attractorsBest = 0;
                    if (game.global.portal.fortress.threat < settings.hellAttractorTopThreat && WarManager.hellAssigned > 0) {
                        if (game.global.portal.fortress.threat > settings.hellAttractorBottomThreat && settings.hellAttractorTopThreat > settings.hellAttractorBottomThreat) {
                            attractorsBest = Math.floor(maxStateOn * (settings.hellAttractorTopThreat - game.global.portal.fortress.threat) / (settings.hellAttractorTopThreat - settings.hellAttractorBottomThreat));
                        } else {
                            attractorsBest = maxStateOn;
                        }
                    }

                    maxStateOn = Math.min(maxStateOn, currentStateOn + 1, Math.max(currentStateOn - 1, attractorsBest));
                }
                // Disable tourist center with full money
                if (building === buildings.TouristCenter && !isHungryRace() && resources.Food.storageRatio < 0.7 && !resources.Money.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Money.getBusyWorkers("tech_tourism", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Money.incomeAdusted = true;
                    }
                }
                // Disable mills with surplus energy
                if (building === buildings.Mill && building.powered && resources.Food.storageRatio < 0.7 && (jobs.Farmer.count > 0 || jobs.Hunter.count > 0)) {
                    maxStateOn = Math.min(maxStateOn, currentStateOn - ((resources.Power.currentQuantity - 5) / (-building.powered)));
                }
                // Disable useless Mine Layers
                if (building === buildings.ChthonianMineLayer) {
                    if (buildings.ChthonianRaider.stateOnCount === 0 && buildings.ChthonianExcavator.stateOnCount === 0) {
                        maxStateOn = 0;
                    } else {
                        let mineAdjust = ((game.global.race['instinct'] ? 7000 : 7500) - poly.piracy("gxy_chthonian")) / game.actions.galaxy.gxy_chthonian.minelayer.ship.rating();
                        maxStateOn = Math.min(maxStateOn, currentStateOn + Math.ceil(mineAdjust));
                    }
                }
                // Disable useless Guard Post
                if (building === buildings.RuinsGuardPost) {
                    if (isHellSupressUseful()) {
                        let postRating = game.armyRating(traitVal('high_pop', 0, 1), "hellArmy", 0) * traitVal('holy', 1, '+');
                        let postAdjust = (5001 - poly.hellSupression("ruins").rating) / postRating;
                        if (haveTech('hell_gate')) {
                            postAdjust = Math.max(postAdjust, (7501 - poly.hellSupression("gate").rating) / postRating);
                        }
                        // We're reserving just one soldier for Guard Posts, so let's increase them by 1
                        maxStateOn = Math.min(maxStateOn, currentStateOn + 1, currentStateOn + Math.ceil(postAdjust));
                    } else {
                        maxStateOn = 0;
                    }
                }
                // Disable Waygate once it cleared, or if we're going to use bomb, or current potential is too hight
                if (building === buildings.SpireWaygate && (haveTech("waygate", 3)
                     || (settings.prestigeDemonicBomb && game.global.stats.spire[poly.universeAffix()]?.dlstr > 0)
                     || (settings.autoMech && MechManager.mechsPotential > settings.mechWaygatePotential && !(settings.autoPrestige && settings.prestigeType === "demonic" && buildings.SpireTower.count >= settings.prestigeDemonicFloor)))) {
                      maxStateOn = 0;
                }
                // Once we unlocked Embassy - we don't need scouts and corvettes until we'll have piracy. Let's freeup support for more Bolognium ships
                if ((building === buildings.ScoutShip || building === buildings.CorvetteShip) && !game.global.tech.piracy && buildings.GorddonEmbassy.isUnlocked()) {
                    maxStateOn = 0;
                }
                // Production buildings with capped resources
                if (building === buildings.BeltEleriumShip && !resources.Elerium.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Elerium.getBusyWorkers("job_space_miner", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Elerium.incomeAdusted = true;
                    }
                }
                if (building === buildings.BeltIridiumShip && !resources.Iridium.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Iridium.getBusyWorkers("job_space_miner", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Iridium.incomeAdusted = true;
                    }
                }
                if (building === buildings.BeltIronShip && !resources.Iron.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Iron.getBusyWorkers("job_space_miner", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Iron.incomeAdusted = true;
                    }
                }
                if (building === buildings.MoonIridiumMine && !resources.Iridium.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Iridium.getBusyWorkers("space_moon_iridium_mine_title", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Iridium.incomeAdusted = true;
                    }
                }
                if (building === buildings.MoonHeliumMine && !resources.Helium_3.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Helium_3.getBusyWorkers("space_moon_helium_mine_title", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Helium_3.incomeAdusted = true;
                    }
                }
                if (building === buildings.Alien2ArmedMiner && !resources.Bolognium.isUseful() && !resources.Adamantite.isUseful() && !resources.Iridium.isUseful()) {
                    let minShips = Math.max(resources.Bolognium.getBusyWorkers("galaxy_armed_miner_bd", currentStateOn),
                                            resources.Adamantite.getBusyWorkers("galaxy_armed_miner_bd", currentStateOn),
                                            resources.Iridium.getBusyWorkers("galaxy_armed_miner_bd", currentStateOn));
                    maxStateOn = Math.min(maxStateOn, minShips);
                    if (maxStateOn !== currentStateOn) {
                        resources.Bolognium.incomeAdusted = true;
                        resources.Adamantite.incomeAdusted = true;
                        resources.Iridium.incomeAdusted = true;
                    }
                }
                if (building === buildings.BologniumShip) {
                    if (buildings.GorddonMission.isAutoBuildable() && buildings.ScoutShip.count >= 2 && buildings.CorvetteShip.count >= 1) {
                        maxStateOn = Math.min(maxStateOn, resources.Gateway_Support.maxQuantity - (buildings.ScoutShip.count + buildings.CorvetteShip.count));
                    }
                    if (!resources.Bolognium.isUseful()) {
                        maxStateOn = Math.min(maxStateOn, resources.Bolognium.getBusyWorkers("galaxy_bolognium_ship", currentStateOn));
                    }
                    if (maxStateOn !== currentStateOn) {
                        resources.Bolognium.incomeAdusted = true;
                    }
                }
                if (building === buildings.ChthonianRaider && !resources.Vitreloy.isUseful() && !resources.Polymer.isUseful() && !resources.Neutronium.isUseful() && !resources.Deuterium.isUseful()) {
                    let minShips = Math.max(resources.Vitreloy.getBusyWorkers("galaxy_raider", currentStateOn),
                                            resources.Polymer.getBusyWorkers("galaxy_raider", currentStateOn),
                                            resources.Neutronium.getBusyWorkers("galaxy_raider", currentStateOn),
                                            resources.Deuterium.getBusyWorkers("galaxy_raider", currentStateOn));
                    maxStateOn = Math.min(maxStateOn, minShips);
                    if (maxStateOn !== currentStateOn) {
                        resources.Vitreloy.incomeAdusted = true;
                        resources.Polymer.incomeAdusted = true;
                        resources.Neutronium.incomeAdusted = true;
                        resources.Deuterium.incomeAdusted = true;
                    }
                }
                if (building === buildings.Alien1VitreloyPlant && !resources.Vitreloy.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Vitreloy.getBusyWorkers("galaxy_vitreloy_plant_bd", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Vitreloy.incomeAdusted = true;
                    }
                }
                if (building === buildings.ChthonianExcavator && !resources.Orichalcum.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Orichalcum.getBusyWorkers("galaxy_excavator", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Orichalcum.incomeAdusted = true;
                    }
                }
                if (building === buildings.EnceladusWaterFreighter && !resources.Water.isUseful()) {
                    maxStateOn = Math.min(maxStateOn, resources.Water.getBusyWorkers("space_water_freighter_title", currentStateOn));
                    if (maxStateOn !== currentStateOn) {
                        resources.Water.incomeAdusted = true;
                    }
                }
                if (building === buildings.NebulaHarvester && !resources.Deuterium.isUseful() && !resources.Helium_3.isUseful()) {
                    let minShips = Math.max(resources.Deuterium.getBusyWorkers("interstellar_harvester_title", currentStateOn),
                                            resources.Helium_3.getBusyWorkers("interstellar_harvester_title", currentStateOn));
                    maxStateOn = Math.min(maxStateOn, minShips);
                    if (maxStateOn !== currentStateOn) {
                        resources.Deuterium.incomeAdusted = true;
                        resources.Helium_3.incomeAdusted = true;
                    }
                }
                // Womling stuff
                if (building === buildings.TauRedWomlingFarm) {
                    let crop_per_farm = haveTech("womling_pop") ? 16 : 12;
                    if (haveTech("womling_gene")) {
                        crop_per_farm += 4;
                    }
                    maxStateOn = Math.min(maxStateOn, Math.ceil(resources.Womlings_Support.maxQuantity / crop_per_farm));
                }
                if (building === buildings.TauRedOverseer) {
                    let loyal_base = game.global.race['womling_friend'] ? 25 :
                                     game.global.race['womling_god'] ? 75 :
                                     game.global.race['womling_lord'] ? 0 : 0;
                    let loyal_per = building.definition.val();
                    let loyal_malus = game.global.tauceti.womling_mine.miners;
                    let overseerNeeded = Math.ceil((100 - (loyal_base - loyal_malus)) / loyal_per);
                    maxStateOn = Math.min(maxStateOn, overseerNeeded);
                }
                if (building === buildings.TauRedWomlingFun) {
                    let morale_base = game.global.race['womling_friend'] ? 75 :
                                      game.global.race['womling_god'] ? 40 :
                                      game.global.race['womling_lord'] ? 30 : 0;
                    let morale_per = building.definition.val();
                    let morale_malus = game.global.tauceti.womling_mine.miners + game.global.tauceti.womling_farm.farmers + game.global.tauceti.overseer.injured;
                    let funNeeded = Math.ceil((100 - (morale_base - morale_malus)) / morale_per);
                    maxStateOn = Math.min(maxStateOn, funNeeded);
                }
                if (building === buildings.TauGasWhalingStation) {
                    let tbs = resources.Tau_Belt_Support;
                    let shipEff = 1-((1-(tbs.maxQuantity/tbs.currentQuantity))**1.4);
                    let blubInc = 8 * shipEff * buildings.TauBeltWhalingShip.stateOnCount;
                    maxStateOn = Math.min(maxStateOn, Math.ceil(blubInc / 12));
                }
                if (building === buildings.TauMiningPit) {
                    maxStateOn = Math.min(maxStateOn, Math.ceil(resources.Population.maxQuantity / 6));
                }
            }

            for (let j = 0; j < building.consumption.length; j++) {
                let resourceType = building.consumption[j];
                // If resource rate is negative then we are gaining resources. So, only check if we are consuming resources
                if (resourceType.rate > 0) {
                    if (!resourceType.resource.isUnlocked()) {
                        maxStateOn = 0;
                        break;
                    }

                    if (resourceType.resource === resources.Food) {
                        // Wendigo doesn't store food. Let's assume it's always available.
                        if (resourceType.resource.storageRatio > 0.05 || isHungryRace()) {
                            continue;
                        }
                    } else if (!(resourceType.resource instanceof Support) && resourceType.resource.storageRatio > 0.01) {
                        // If we have more than xx% of our storage then its ok to lose some resources.
                        // This check is mainly so that power producing buildings don't turn off when rate of change goes negative.
                        // That can cause massive loss of life if turning off space habitats :-)
                        continue;
                    }
                    else if (resourceType.resource === resources.Tau_Belt_Support)
                    {
                        // Tau Belt support can be overused
                        continue;
                    }

                    let supportedAmount = resourceType.resource.rateOfChange / resourceType.rate;
                    if (resourceType.resource === resources.Womlings_Support) {
                        // Womlings facilities can run understaffed
                        supportedAmount = Math.ceil(supportedAmount);
                    }

                    maxStateOn = Math.min(maxStateOn, supportedAmount);
                }
            }

            // If this is a power producing structure then only turn off one at a time!
            if (building.powered < 0) {
                maxStateOn = Math.max(maxStateOn, currentStateOn - 1);
            }

            maxStateOn = Math.max(0, Math.floor(maxStateOn));

            // Now when we know how many buildings we need - let's take resources
            for (let k = 0; k < building.consumption.length; k++) {
                let resourceType = building.consumption[k];

                if (building === buildings.BeltSpaceStation && resourceType.resource === resources.Belt_Support) {
                    resources.Belt_Support.rateOfChange += resources.Belt_Support.maxQuantity;
                } else {
                    resourceType.resource.rateOfChange -= building.getFuelRate(k) * maxStateOn;
                }
            }

            building.tryAdjustState(maxStateOn - currentStateOn);

            if (building === buildings.NeutronCitadel) {
                availablePower -= getCitadelConsumption(maxStateOn);
            } else {
                availablePower -= building.powered * maxStateOn;
            }
        }

        if (manageTransport && resources.Lake_Support.rateOfChange > 0) {
            let lakeSupport = resources.Lake_Support.rateOfChange;
            let rating = game.global.blood['spire'] && game.global.blood.spire >= 2 ? 0.8 : 0.85;
            let bireme = buildings.LakeBireme;
            let transport = buildings.LakeTransport;
            let biremeCount = bireme.count;
            let transportCount = transport.count;
            while (biremeCount + transportCount > lakeSupport) {
                let nextBireme = (1 - (rating ** (biremeCount - 1))) * (transportCount * 5);
                let nextTransport = (1 - (rating ** biremeCount)) * ((transportCount - 1) * 5);
                if (nextBireme > nextTransport) {
                    biremeCount--;
                } else {
                    transportCount--;
                }
            }
            bireme.tryAdjustState(biremeCount - bireme.stateOnCount);
            transport.tryAdjustState(transportCount - transport.stateOnCount);
        }

        if (manageSpire && resources.Spire_Support.rateOfChange > 0) {
            // Try to prevent building bays when they won't have enough time to work out used supplies. It assumes that time to build new bay ~= time to clear floor.
            // Make sure we have some transports, so we won't stuck with 0 supply income after disabling collectors, and also let mech manager finish rebuilding after switching floor
            // And also let autoMech do minimum preparation, so we won't stuck with near zero potential
            let buildAllowed = settings.autoBuild && !(settings.autoMech && MechManager.isActive) && !(settings.autoPrestige && settings.prestigeType === "demonic" && settings.prestigeDemonicFloor - buildings.SpireTower.count <= buildings.SpireMechBay.count);

            // Check is we allowed to build specific building, and have money for it
            const canBuild = (building, checkSmart) => buildAllowed && building.isAutoBuildable() && resources.Money.maxQuantity >= (building.cost["Money"] ?? 0) && (!checkSmart || building.isSmartManaged());

            let spireSupport = Math.floor(resources.Spire_Support.rateOfChange);
            let maxBay = Math.min(buildings.SpireMechBay.count, spireSupport);
            let currentPort = buildings.SpirePort.count;
            let currentCamp = buildings.SpireBaseCamp.count;
            let maxPorts = canBuild(buildings.SpirePort) ? buildings.SpirePort.autoMax : currentPort;
            let maxCamps = canBuild(buildings.SpireBaseCamp) ? buildings.SpireBaseCamp.autoMax : currentCamp;
            let nextMechCost = canBuild(buildings.SpireMechBay, true) ? buildings.SpireMechBay.cost["Supply"] : Number.MAX_SAFE_INTEGER;
            let nextPuriCost = canBuild(buildings.SpirePurifier, true) ? buildings.SpirePurifier.cost["Supply"] : Number.MAX_SAFE_INTEGER;
            let mechQueued = state.queuedTargetsAll.includes(buildings.SpireMechBay);
            let puriQueued = state.queuedTargetsAll.includes(buildings.SpirePurifier);

            let [bestSupplies, bestPort, bestBase] = getBestSupplyRatio(spireSupport, maxPorts, maxCamps);
            buildings.SpirePurifier.extraDescription = `Supported Supplies: ${Math.floor(bestSupplies)}<br>${buildings.SpirePurifier.extraDescription}`;

            let nextCost =
              mechQueued && nextMechCost <= bestSupplies ? nextMechCost :
              puriQueued && nextPuriCost <= bestSupplies ? nextPuriCost :
              Math.min(nextMechCost, nextPuriCost);
            MechManager.saveSupply = nextCost <= bestSupplies;

            let assignStorage = mechQueued || puriQueued;
            for (let targetMech = maxBay; targetMech >= 0; targetMech--) {
                let [targetSupplies, targetPort, targetCamp] = getBestSupplyRatio(spireSupport - targetMech, maxPorts, maxCamps);

                let missingStorage =
                    targetPort > currentPort ? buildings.SpirePort :
                    targetCamp > currentCamp ? buildings.SpireBaseCamp :
                    null;
                if (missingStorage) {
                    for (let i = maxBay; i >= 0; i--) {
                        let [storageSupplies, storagePort, storageCamp] = getBestSupplyRatio(spireSupport - i, currentPort, currentCamp);
                        if (storageSupplies >= missingStorage.cost["Supply"]) {
                            adjustSpire(i, storagePort, storageCamp);
                            break;
                        }
                    }
                    break;
                }

                if (resources.Supply.currentQuantity >= targetSupplies) {
                    assignStorage = true;
                }
                if (!assignStorage || bestSupplies < nextCost || targetSupplies >= nextCost) {
                    // TODO: Assign storage gradually while it fills, instead of dropping directly to target. That'll need better intregration with autoBuild, to make sure it won't spent supplies on wrong building seeing that target still unaffrodable, and not knowing that it's temporaly
                    adjustSpire(targetMech, targetPort, targetCamp);
                    break;
                }
            }
        }

        // Manages the Tau Ceti materials phase by force-enabling minimum number of mining pits needed to build next item.
        // Required amount may change as buildings are built so this needs to run every tick while in materials phase.
        if (manageTauCetiMaterials && resources.Tau_Support.maxQuantity > 0) {
            const miningPitAmount = 1e6;
            const tauSupport = resources.Tau_Support.maxQuantity;
            let colony = buildings.TauColony, orbital = buildings.TauOrbitalStation, pit = buildings.TauMiningPit;
            let nextColonyPitRequirement = Math.ceil((colony.cost?.Materials ?? -Infinity) / miningPitAmount);
            let nextOrbitalPitRequirement = Math.ceil((orbital.cost?.Materials ?? -Infinity) / miningPitAmount);
            let nextMiningPitPitRequirement = Math.ceil((pit.cost?.Materials ?? -Infinity) / miningPitAmount);
            // We must target the maximum amount because of limitations in autoBuild weighting rules
            // Non operating buildings check really messes things up
            let minimumPits = Math.max(nextColonyPitRequirement, nextOrbitalPitRequirement, nextMiningPitPitRequirement);
            // Bad math/never turn off all pits/need more pits than available for all options (all red)/can't support required number of pits
            if (!isFinite(minimumPits) || minimumPits <= 0 || minimumPits > pit.count || minimumPits > tauSupport) {
                minimumPits = 1;
            }

            let newPitCount = minimumPits;
            let newColonyCount = 0;
            let availableSupport = tauSupport - newPitCount;
            // May cause an infinite loop if Infinity or NaN, avoid. Should never happen but there may be some edge cases with the game.
            if (!isFinite(availableSupport)) {
                throw "Avoiding infinite loop in manageTauCetiMaterials";
            }
            while (availableSupport > 0) {
                // As long as we have 2 pits to turn on, we calculate for the +2 case instead, because 1 colony uses 2 support.
                // Otherwise, we calculate for the +1 case. Will be fine even if we have 2 pits but only 1 support since adding the colony will fail.
                let availablePits = Math.min(pit.count - newPitCount, 2);
                let nextPitPower = (newPitCount + availablePits) * (1 + (newColonyCount * 0.5));
                let nextColonyPower = newPitCount * (1 + ((newColonyCount + 1) * 0.5));
                if (availableSupport >= 2 && (newColonyCount + 1) <= colony.count && (nextColonyPower > nextPitPower || !availablePits)) {
                    availableSupport -= 2;
                    newColonyCount++;
                }
                else if ((newPitCount + 1) <= pit.count) {
                    availableSupport--;
                    newPitCount++;
                }
                else {
                    // Avoid infinite loop if more support than buildings
                    break;
                }
            }

            console.info("manageTauCetiMaterials: Setting to: %d colonies, %d pits", newColonyCount, newPitCount);
            colony.tryAdjustState(newColonyCount - colony.stateOnCount);
            pit.tryAdjustState(newPitCount - pit.stateOnCount);
        }

        resources.Power.currentQuantity = availablePower;
        resources.Power.rateOfChange = availablePower;

        // Disable underpowered buildings, one at time. Unless it's ship - which may stay with warning until they'll get crew
        let warnBuildings = $("span.on.warn");
        for (let i = 0; i < warnBuildings.length; i++) {
            let building = buildingIds[warnBuildings[i].parentNode.id];
            if (building && building.autoStateEnabled && !building.is.ship) {
                if (building === buildings.BeltEleriumShip || building === buildings.BeltIridiumShip || building === buildings.BeltIronShip) {
                    let beltSupportNeeded = (buildings.BeltEleriumShip.stateOnCount * 2 + buildings.BeltIridiumShip.stateOnCount + buildings.BeltIronShip.stateOnCount) * traitVal('high_pop', 0, 1);
                    if (beltSupportNeeded <= resources.Belt_Support.maxQuantity) {
                        continue;
                    }
                }
                if (building === buildings.LakeBireme || building === buildings.LakeTransport) {
                    let lakeSupportNeeded = buildings.LakeBireme.stateOnCount + buildings.LakeTransport.stateOnCount;
                    if (lakeSupportNeeded <= resources.Lake_Support.maxQuantity) {
                        continue;
                    }
                }
                if (building === buildings.TauBeltWhalingShip || building === buildings.TauBeltMiningShip) {
                    continue;
                }
                building.tryAdjustState(-1);
                break;
            }
        }
    }

    function adjustSpire(mech, port, camp) {
        buildings.SpireMechBay.tryAdjustState(mech - buildings.SpireMechBay.stateOnCount);
        buildings.SpirePort.tryAdjustState(port - buildings.SpirePort.stateOnCount);
        buildings.SpireBaseCamp.tryAdjustState(camp - buildings.SpireBaseCamp.stateOnCount);
    }

    function getBestSupplyRatio(support, maxPorts, maxCamps) {
        let bestPort = 0;
        let bestCamp = 0;

        let optPort = Math.ceil(support / 2 + 1);
        let optCamp = Math.floor(support / 2 - 1);
        if (support <= 3 || optPort > maxPorts) {
            bestPort = Math.min(maxPorts, support);
            bestCamp = Math.min(maxCamps, support - bestPort);
        } else if (optCamp > maxCamps) {
            bestCamp = Math.min(maxCamps, support);
            bestPort = Math.min(maxPorts, support - bestCamp);
        } else if (optPort <= maxPorts && optCamp <= maxCamps) {
            bestPort = optPort;
            bestCamp = optCamp;
        }
        let supplies = Math.round(bestPort * (1 + bestCamp * 0.4) * 10000 + 100);
        return [supplies, bestPort, bestCamp];
    }

    function expandStorage(storageToBuild) {
        let missingStorage = storageToBuild;
        let numberOfCratesWeCanBuild = resources.Crates.maxQuantity - resources.Crates.currentQuantity;
        let numberOfContainersWeCanBuild = resources.Containers.maxQuantity - resources.Containers.currentQuantity;

        for (let res in resources.Crates.cost) {
            numberOfCratesWeCanBuild = Math.min(numberOfCratesWeCanBuild, resources[res].currentQuantity / resources.Crates.cost[res]);
        }
        for (let res in resources.Containers.cost) {
            numberOfContainersWeCanBuild = Math.min(numberOfContainersWeCanBuild, resources[res].currentQuantity / resources.Containers.cost[res]);
        }

        if (settings.storageLimitPreMad && isEarlyGame()) {
            // Only build pre-mad containers when steel is excessing
            if (resources.Steel.storageRatio < 0.8) {
                numberOfContainersWeCanBuild = 0;
            }
            // Only build pre-mad crates when already have Plywood for next level of library
            if (isLumberRace() && buildings.Library.count < 20 && buildings.Library.cost["Plywood"] > resources.Plywood.currentQuantity && resources.Steel.maxQuantity >= resources.Steel.storageRequired) {
                numberOfCratesWeCanBuild = 0;
            }
        }

        // Build crates
        let cratesToBuild = Math.min(Math.floor(numberOfCratesWeCanBuild), Math.ceil(missingStorage / StorageManager.crateValue));
        StorageManager.constructCrate(cratesToBuild);

        resources.Crates.currentQuantity += cratesToBuild;
        for (let res in resources.Crates.cost) {
            resources[res].currentQuantity -= resources.Crates.cost[res] * cratesToBuild;
        }
        missingStorage -= cratesToBuild * StorageManager.crateValue;

        // And containers, if still needed
        if (missingStorage > 0) {
            let containersToBuild = Math.min(Math.floor(numberOfContainersWeCanBuild), Math.ceil(missingStorage / StorageManager.containerValue));
            StorageManager.constructContainer(containersToBuild);

            resources.Containers.currentQuantity += containersToBuild;
            for (let res in resources.Containers.cost) {
                resources[res].currentQuantity -= resources.Containers.cost[res] * containersToBuild;
            }
            missingStorage -= containersToBuild * StorageManager.containerValue;
        }
        return missingStorage < storageToBuild;
    }

    // TODO: Implement preserving of old layout, to reduce flickering
    function autoStorage() {
        let m = StorageManager;
        if (!m.initStorage()) {
            return;
        }

        if (m.crateValue <= 0 || m.containerValue <= 0) {
            // Shouldn't ever happen, but better check than sorry. Trying to adjust storages thinking that crates are worthless could end pretty bad.
            return;
        }

        let storageList = m.priorityList.filter(r => r.isUnlocked() && r.isManagedStorage());
        if (storageList.length === 0) {
            return;
        }

        // Init base storage and multipliers
        let totalCrates = resources.Crates.currentQuantity;
        let totalContainers = resources.Containers.currentQuantity;
        let storageAdjustments = {}, resMods = {}, resCurrent = {}, resOverflow = {}, resMin = {}, resRequired = {};
        for (let resource of storageList){
            let res = resource.id;

            if (!settings.storageAssignExtra) {
                resMods[res] = 1;
            } else {
                let sellAllowed = !game.global.race['no_trade'] && settings.autoMarket && resource.autoSellEnabled && resource.autoSellRatio > 0;
                resMods[res] = sellAllowed ? 1.03 / resource.autoSellRatio : 1.03;
            }

            if (resource.storeOverflow) {
                resOverflow[res] = resource.currentQuantity * 1.03;
            }
            resRequired[res] = resource.storageRequired;
            resCurrent[res] = resource.currentQuantity;
            resMin[res] = resource.minStorage;

            storageAdjustments[res] = {crate: 0, container: 0, amount: resource.maxQuantity - (resource.currentCrates * m.crateValue + resource.currentContainers * m.containerValue)};
            totalCrates += resource.currentCrates;
            totalContainers += resource.currentContainers;
        }

        let buildingsList = [];
        let storageEntries = storageList.map((res) => [res.id, []]);
        const addList = list => {
            let resGroups = Object.fromEntries(storageEntries);
            list.forEach(obj => storageList.find(res => obj.cost[res.id] && resGroups[res.id].push(obj)));
            Object.entries(resGroups).forEach(([res, list]) => list.sort((a, b) => b.cost[res] - a.cost[res]));
            buildingsList.push(...Object.values(resGroups).flat());
        }

        // TODO: Configurable priority?
        if (settings.storageSafeReassign) {
            addList([{cost: resCurrent, isList: true}]);
        }
        addList([{cost: resMin, isList: true}]);
        addList([{cost: resOverflow, isList: true}]);
        addList(state.queuedTargetsAll);
        addList(state.triggerTargets);
        if (settings.autoFleet && FleetManagerOuter.nextShipExpandable && settings.prioritizeOuterFleet !== "ignore") {
            addList([{cost: FleetManagerOuter.nextShipCost}]);
        }
        addList(state.unlockedTechs);
        addList(ProjectManager.priorityList.filter(b => b.isUnlocked() && b.autoBuildEnabled));
        addList(BuildingManager.priorityList.filter(p => p.isUnlocked() && p.autoBuildEnabled));
        if (settings.storageAssignPart) {
            addList([{cost: resRequired, isList: true}]);
        }

        let storageToBuild = 0;
        // Calculate required storages
        nextBuilding:
        for (let item of buildingsList) {
            let currentAssign = {};
            let remainingCrates = totalCrates;
            let remainingContainers = totalContainers;

            for (let res in item.cost) {
                let resource = resources[res];
                let quantity = item.cost[res];
                let mod = item.isList ? 1 : resMods[res];

                if (!storageAdjustments[res]) {
                    if (resource.maxQuantity >= quantity) {
                        // Non-expandable, storage met - we're good
                        continue;
                    } else {
                        // Non-expandable, storage not met - ignore building
                        continue nextBuilding;
                    }
                } else if (storageAdjustments[res].amount >= quantity * mod) {
                    // Expandable, storage met - we're good
                    continue;
                }
                if (!item.isList && resource.maxStorage >= 0 && resource.maxStorage < quantity * mod) {
                    continue nextBuilding;
                }
                // Expandable, storage not met - try to assign
                let missingStorage = Math.min((resource.maxStorage >= 0 ? resource.maxStorage : Number.MAX_SAFE_INTEGER), quantity * mod) - storageAdjustments[res].amount;
                let availableStorage = (remainingCrates * m.crateValue) + (remainingContainers * m.containerValue);
                if (item.isList || missingStorage <= availableStorage) {
                    currentAssign[res] = {crate: 0, container: 0};
                    if (missingStorage > 0 && remainingCrates > 0) {
                        let assignCrates = Math.min(Math.ceil(missingStorage / m.crateValue), remainingCrates);
                        remainingCrates -= assignCrates;
                        missingStorage -= assignCrates * m.crateValue;
                        currentAssign[res].crate = assignCrates;
                    }
                    if (missingStorage > 0 && remainingContainers > 0) {
                        let assignContainer = Math.min(Math.ceil(missingStorage / m.containerValue), remainingContainers);
                        remainingContainers -= assignContainer;
                        missingStorage -= assignContainer * m.containerValue;
                        currentAssign[res].container = assignContainer;
                    }
                    if (missingStorage > 0) {
                        storageToBuild = Math.max(storageToBuild, missingStorage);
                    }
                } else {
                    storageToBuild = Math.max(storageToBuild, missingStorage - availableStorage);
                    continue nextBuilding;
                }
            }
            // Building as affordable, record used storage
            for (let id in currentAssign) {
                storageAdjustments[id].crate += currentAssign[id].crate;
                storageAdjustments[id].container += currentAssign[id].container;
                storageAdjustments[id].amount += currentAssign[id].crate * m.crateValue + currentAssign[id].container * m.containerValue;
            }
            totalCrates = remainingCrates;
            totalContainers = remainingContainers;
        }

        // Missing storage, try to build more
        if (storageToBuild > 0 && expandStorage(storageToBuild)) {
            // Stop if we bought something, we'll continue in next tick, after re-calculation of required storage
            return;
        }

        // Go to clicking, unassign first
        for (let id in storageAdjustments) {
            let resource = resources[id];
            let crateDelta = storageAdjustments[id].crate - resource.currentCrates;
            let containerDelta = storageAdjustments[id].container - resource.currentContainers;
            if (crateDelta < 0) {
                m.unassignCrate(resource, crateDelta * -1);
                resource.maxQuantity += crateDelta * m.crateValue;
                resources.Crates.currentQuantity -= crateDelta;
            }
            if (containerDelta < 0) {
                m.unassignContainer(resource, containerDelta * -1);
                resource.maxQuantity += containerDelta * m.containerValue;
                resources.Containers.currentQuantity -= containerDelta;
            }
        }
        for (let id in storageAdjustments) {
            let resource = resources[id];
            let crateDelta = storageAdjustments[id].crate - resource.currentCrates;
            let containerDelta = storageAdjustments[id].container - resource.currentContainers;
            if (crateDelta > 0) {
                m.assignCrate(resource, crateDelta);
                resource.maxQuantity += crateDelta * m.crateValue;
                resources.Crates.currentQuantity += crateDelta;
            }
            if (containerDelta > 0) {
                m.assignContainer(resource, containerDelta);
                resource.maxQuantity += containerDelta * m.containerValue;
                resources.Containers.currentQuantity += containerDelta;
            }
        }
    }

    function autoMinorTrait() {
        let m = MinorTraitManager;
        if (!m.isUnlocked()) {
            return;
        }

        let traitList = m.managedPriorityList();
        if (traitList.length === 0) {
            return;
        }

        let totalWeighting = 0;
        let totalGeneCost = 0;

        traitList.forEach(trait => {
            totalWeighting += trait.weighting;
            totalGeneCost += trait.geneCost();
        });

        traitList.forEach(trait => {
            let traitCost = trait.geneCost();
            if (trait.weighting / totalWeighting >= traitCost / totalGeneCost && resources.Genes.currentQuantity >= traitCost) {
                m.buyTrait(trait.traitName);
                resources.Genes.currentQuantity -= traitCost;
            }
        });
    }

    function autoMutateTrait() {
        let m = MutableTraitManager;
        if (!m.isUnlocked()) {
            return;
        }

        let currency = game.global.race.universe === "antimatter" ? resources.Antiplasmid : resources.Plasmid;

        for (let trait of m.priorityList) {
            if (trait.canGain()) {
                let mutationCost = trait.mutationCost('gain');
                m.gainTrait(trait.traitName);
                GameLog.logSuccess("mutation", `Mutating in ${trait.name} for ${mutationCost} ${currency.name}`);
                currency.currentQuantity -= mutationCost;
                return; // only mutate one trait per tick, to reduce lag
            }

            if (trait.canPurge()) {
                let mutationCost = trait.mutationCost('purge');
                m.purgeTrait(trait.traitName);
                GameLog.logSuccess("mutation", `Mutating out ${trait.name} for ${mutationCost} ${currency.name}`);
                currency.currentQuantity -= mutationCost;
                return; // only mutate one trait per tick, to reduce lag
            }
        }
    }

    function adjustTradeRoutes() {
        let tradableResources = MarketManager.priorityList
          .filter(r => r.isRoutesUnlocked() && (r.autoTradeBuyEnabled || r.autoTradeSellEnabled))
          .sort((a, b) => (b.storageRatio > 0.99 ? b.tradeSellPrice * 1000 : b.usefulRatio) - (a.storageRatio > 0.99 ? a.tradeSellPrice * 1000 : a.usefulRatio));
        let requiredTradeRoutes = {};
        let currentMoneyPerSecond = resources.Money.rateOfChange;
        let tradeRoutesUsed = 0;
        let importRouteCap = MarketManager.getImportRouteCap();
        let exportRouteCap = MarketManager.getExportRouteCap();
        let [maxTradeRoutes, unmanagedTradeRoutes] = MarketManager.getMaxTradeRoutes();

        // Fill trade routes with selling
        for (let i = 0; i < tradableResources.length; i++) {
            let resource = tradableResources[i];
            if (!resource.autoTradeSellEnabled) {
                continue;
            }
            requiredTradeRoutes[resource.id] = 0;

            if (tradeRoutesUsed >= maxTradeRoutes
                || (game.global.race['banana'] && tradeRoutesUsed > 0)
                || (settings.tradeRouteSellExcess
                  ? resource.usefulRatio < 1
                  : resource.storageRatio < 0.99)) {
                continue;
            }

            let routesToAssign = Math.min(exportRouteCap, maxTradeRoutes - tradeRoutesUsed, Math.floor(resource.rateOfChange / resource.tradeRouteQuantity));
            if (routesToAssign > 0) {
                tradeRoutesUsed += routesToAssign;
                requiredTradeRoutes[resource.id] -= routesToAssign;
                currentMoneyPerSecond += resource.tradeSellPrice * routesToAssign;
            }
        }
        let minimumAllowedMoneyPerSecond = Math.min(resources.Money.maxQuantity - resources.Money.currentQuantity, Math.max(settings.tradeRouteMinimumMoneyPerSecond, settings.tradeRouteMinimumMoneyPercentage / 100 * currentMoneyPerSecond));

        // Init adjustment, and sort groups by priorities
        let priorityGroups = {};
        for (let i = 0; i < tradableResources.length; i++) {
            let resource = tradableResources[i];
            if (!resource.autoTradeBuyEnabled) {
                continue;
            }
            requiredTradeRoutes[resource.id] = requiredTradeRoutes[resource.id] ?? 0;

            if (resource.autoTradeWeighting <= 0
                || (settings.tradeRouteSellExcess
                  ? resource.usefulRatio > 0.99
                  : resource.storageRatio > 0.98)) {
                continue;
            }

            let priority = resource.autoTradePriority;
            if (resource.isDemanded()) {
                priority = Math.max(priority, 100);
                if (!resources.Money.isDemanded()) {
                    // Resource demanded, money not demanded - ignore min money, and spend as much as possible
                    minimumAllowedMoneyPerSecond = 0;
                }
            } else if ((priority < 100 && priority !== -1) && resources.Money.isDemanded()) {
                // Don't buy resources with low priority when money is demanded
                continue;
            }

            if (priority !== 0) {
                priorityGroups[priority] = priorityGroups[priority] ?? [];
                priorityGroups[priority].push(resource);
            }
        }
        let priorityList = Object.keys(priorityGroups).sort((a, b) => b - a).map(key => priorityGroups[key]);
        if (priorityGroups["-1"] && priorityList.length > 1) {
            priorityList.splice(priorityList.indexOf(priorityGroups["-1"], 1));
            priorityList[0].push(...priorityGroups["-1"]);
        }

        // Calculate amount of routes per resource
        let resSorter = (a, b) => ((requiredTradeRoutes[a.id] / a.autoTradeWeighting) - (requiredTradeRoutes[b.id] / b.autoTradeWeighting)) || b.autoTradeWeighting - a.autoTradeWeighting;
        let remainingRoutes, unassignStep;
        if (getGovernor() === "entrepreneur") {
            remainingRoutes = tradeRoutesUsed - unmanagedTradeRoutes;
            unassignStep = 2;
        } else {
            remainingRoutes = maxTradeRoutes;
            unassignStep = 1;
        }
        outerLoop:
        for (let i = 0; i < priorityList.length && remainingRoutes > 0; i++) {
            let trades = priorityList[i].sort((a, b) => a.autoTradeWeighting - b.autoTradeWeighting);
            assignLoop:
            while(trades.length > 0 && remainingRoutes > 0) {
                let resource = trades.sort(resSorter)[0];
                // TODO: Fast assign for single resource

                if (requiredTradeRoutes[resource.id] >= importRouteCap) {
                    trades.shift();
                    continue;
                }
                // Stop if next route will lower income below allowed minimum
                if (currentMoneyPerSecond - resource.tradeBuyPrice < minimumAllowedMoneyPerSecond) {
                    break outerLoop;
                }

                if (tradeRoutesUsed < maxTradeRoutes) {
                    // Still have unassigned routes
                    currentMoneyPerSecond -= resource.tradeBuyPrice;
                    tradeRoutesUsed++;
                    remainingRoutes--;
                    requiredTradeRoutes[resource.id]++;
                } else {
                    // No free routes, remove selling
                    for (let otherId in requiredTradeRoutes) {
                        if (requiredTradeRoutes[otherId] === undefined) {
                            continue
                        }
                        let otherResource = resources[otherId];
                        let currentRequired = requiredTradeRoutes[otherId];
                        if (currentRequired >= 0 || resource === otherResource) {
                            continue;
                        }

                        if (currentMoneyPerSecond - otherResource.tradeSellPrice - resource.tradeBuyPrice > minimumAllowedMoneyPerSecond && remainingRoutes >= unassignStep) {
                            currentMoneyPerSecond -= otherResource.tradeSellPrice;
                            currentMoneyPerSecond -= resource.tradeBuyPrice;
                            requiredTradeRoutes[otherId]++;
                            requiredTradeRoutes[resource.id]++;
                            remainingRoutes -= unassignStep;
                            continue assignLoop;
                        }
                    }
                    // Couldn't remove route, stop asigning
                    break outerLoop;
                }
            }
        }

        // Adjust our trade routes - always adjust towards zero first to free up trade routes
        let adjustmentTradeRoutes = [];
        for (let i = 0; i < tradableResources.length; i++) {
            let resource = tradableResources[i];
            if (requiredTradeRoutes[resource.id] === undefined) {
                continue;
            }
            adjustmentTradeRoutes[i] = requiredTradeRoutes[resource.id] - resource.tradeRoutes;

            if (requiredTradeRoutes[resource.id] === 0 && resource.tradeRoutes !== 0) {
                MarketManager.zeroTradeRoutes(resource);
                adjustmentTradeRoutes[i] = 0;
            } else if (adjustmentTradeRoutes[i] > 0 && resource.tradeRoutes < 0) {
                MarketManager.addTradeRoutes(resource, adjustmentTradeRoutes[i]);
                adjustmentTradeRoutes[i] = 0;
            } else if (adjustmentTradeRoutes[i] < 0 && resource.tradeRoutes > 0) {
                MarketManager.removeTradeRoutes(resource, -1 * adjustmentTradeRoutes[i]);
                adjustmentTradeRoutes[i] = 0;
            }
        }

        // Adjust our trade routes - we've adjusted towards zero, now adjust the rest
        for (let i = 0; i < tradableResources.length; i++) {
            let resource = tradableResources[i];
            if (requiredTradeRoutes[resource.id] === undefined) {
                continue;
            }

            if (adjustmentTradeRoutes[i] > 0) {
                MarketManager.addTradeRoutes(resource, adjustmentTradeRoutes[i]);
            } else if (adjustmentTradeRoutes[i] < 0) {
                MarketManager.removeTradeRoutes(resource, -1 * adjustmentTradeRoutes[i]);
            }
        }
        // It does change rates of changes of resources, but we don't want to store this changes.
        // Sold resources can be easily reclaimed, and we want to be able to use it for production, ejecting, upkeep, etc, so let's pretend they're still here
        // And bought resources are dungerous to use - we don't want to end with negative income after recalculating trades
        resources.Money.rateOfChange = currentMoneyPerSecond;
    }

    function autoFleetOuter() {
        let m = FleetManagerOuter;
        m.nextShipDesiredCrew = 0; // Should always be set to 0 unless eval result is short on crew

        // To let users make ship adjustments via script
        let previousTargetRegion = m.nextShipRegion;
        m.nextShipRegion = null; // Should always be set to null if region not yet selected

        if (!m.initFleet()) {
            m.nextShipMsg = `No ships needed yet`;
            m.updateNextShip();
            return;
        }

        if (settings.fleetOuterShips === "none") {
            m.updateNextShip();
            m.nextShipMsg = `Ship construction is disabled`;
            return;
        }

        let yard = game.global.space.shipyard;

        if (settings.fleetOuterShips === "manual") {
            m.updateNextShip(m.avail(yard.blueprint) ? yard.blueprint : null);
            m.nextShipMsg = `Ships managed manually`;
            return;
        }

        let targetRegion = null;
        let newShip = null;
        let minCrew = settings.fleetOuterCrew; // Ignored by Tau Explorer and Eris Scout

        if (settings.fleetExploreTau && game.global.tech['tauceti'] === 1 && m.avail(m._explorerBlueprint) && m.shipCount('tauceti', m._explorerBlueprint) < 1) {
            targetRegion = "tauceti";
            newShip = m._explorerBlueprint;
            minCrew = 0;
        } else {
            let scanEris = game.global.tech['eris'] === 1 && m.getWeighting("spc_eris") > 0 && m.syndicate("spc_eris", true, true).s < 50;
            let scout = m.getScoutBlueprint();
            // Assume scout class and sensor don't change but everything else is OK to change.
            // TODO: Ideally this would all be based off region intel %.
            let scoutToFind = {"class": scout["class"], "sensor": scout["sensor"], "power": null, "weapon": null, "armor": null, "engine": null};
            if (scanEris) {
                targetRegion = "spc_eris";
                minCrew = 0;
            } else {
                let regionsToProtect = m.Regions.filter(reg => {
                    if (!m.isUnlocked(reg) || m.getWeighting(reg) <= 0) return false;

                    let needScout = m.shipCount(reg, scoutToFind) < m.getMaxScouts(reg);
                    let needDefense = m.syndicate(reg, false, true) < m.getMaxDefense(reg);
                    return needScout || needDefense;
                }).sort((a, b) => ((1 - m.syndicate(b, false, true)) * m.getWeighting(b))
                                  - ((1 - m.syndicate(a, false, true)) * m.getWeighting(a)));

                if (regionsToProtect.length < 1) {
                    m.updateNextShip();
                    m.nextShipMsg = `No more ships currently needed`;
                    return;
                }
                targetRegion = regionsToProtect[0];
            }

            if (settings.fleetOuterShips === "user") {
                newShip = m.avail(yard.blueprint) ? yard.blueprint : null;
            }
            else {
                if (m.avail(scout) && m.shipCount(targetRegion, scoutToFind) < m.getMaxScouts(targetRegion)) {
                    newShip = scout;
                }
                if (!newShip) {
                    let fighter =  m.getFighterBlueprint();
                    newShip = m.avail(fighter) ? fighter : null;
                }
            }
        }

        // If we get here, set it as target region.
        m.nextShipRegion = targetRegion;
        // If we changed region, we need to wait 1 tick now.
        if (previousTargetRegion !== targetRegion) {
            m.nextShipMsg = `Waiting to dispatch to ${m.getLocName(targetRegion)}`;
            return;
        }

        if (!newShip) {
            m.updateNextShip();
            m.nextShipMsg = `No suitable blueprint for ship to ${m.getLocName(targetRegion)}`;
            return;
        }

        m.updateNextShip(newShip);
        m.nextShipName = `${m.getShipName(newShip)} to ${m.getLocName(targetRegion)}`;

        let missing = m.getMissingResource(newShip);
        if (missing) {
            m.nextShipMsg = `Next ship(${m.nextShipName}) is missing ${resources[missing].name}`;
            return;
        }

        if (WarManager.currentCityGarrison - m.ClassCrew[newShip.class] < minCrew) {
            m.nextShipMsg = `Next ship(${m.nextShipName}) is missing crew`;
            // This must ONLY be set here, and only needs to be set if the crew left-over isn't enough.
            // We don't want to take crew from FOB landers until the very moment it's needed.
            // It's set to 0 earlier in this function, so in all other cases it will be set to 0.
            m.nextShipDesiredCrew = minCrew;
            return;
        }

        if (m.build(newShip, targetRegion)) {
            GameLog.logSuccess("outer_fleet", `${m.getShipName(newShip)} has been assembled, and dispatched to ${m.getLocName(targetRegion)}.`, ['combat']);
            m.nextShipRegion = null; // Wait a tick between ship dispatches
        } else {
            m.nextShipMsg = `Invalid design! Next ship(${m.nextShipName}) is missing power`;
            return;
        }
    }

    function autoFleet() {
        if (!FleetManager.initFleet()) {
            return;
        }
        let def = game.global.galaxy.defense;

        // Init our current state
        let allRegions = [
            {name: "gxy_stargate", piracy: (game.global.race['instinct'] ? 0.09 : 0.1) * game.global.tech.piracy, armada: buildings.StargateDefensePlatform.stateOnCount * 20, useful: true},
            {name: "gxy_gateway", piracy: (game.global.race['instinct'] ? 0.09 : 0.1) * game.global.tech.piracy, armada: buildings.GatewayStarbase.stateOnCount * 25, useful: buildings.BologniumShip.stateOnCount > 0},
            {name: "gxy_gorddon", piracy: (game.global.race['instinct'] ? 720 : 800), armada: 0, useful: buildings.GorddonFreighter.stateOnCount > 0 || buildings.Alien1SuperFreighter.stateOnCount > 0 || buildings.GorddonSymposium.stateOnCount > 0},
            {name: "gxy_alien1", piracy: (game.global.race['instinct'] ? 900 : 1000), armada: 0, useful: buildings.Alien1VitreloyPlant.stateOnCount > 0},
            {name: "gxy_alien2", piracy: (game.global.race['instinct'] ? 2250 : 2500), armada: buildings.Alien2Foothold.stateOnCount * 50 + buildings.Alien2ArmedMiner.stateOnCount * game.actions.galaxy.gxy_alien2.armed_miner.ship.rating(), useful: buildings.Alien2Scavenger.stateOnCount > 0 || buildings.Alien2ArmedMiner.stateOnCount > 0},
            {name: "gxy_chthonian", piracy: (game.global.race['instinct'] ? 7000 : 7500), armada: buildings.ChthonianMineLayer.stateOnCount * game.actions.galaxy.gxy_chthonian.minelayer.ship.rating() + buildings.ChthonianRaider.stateOnCount * game.actions.galaxy.gxy_chthonian.raider.ship.rating(), useful: buildings.ChthonianExcavator.stateOnCount > 0 || buildings.ChthonianRaider.stateOnCount > 0},
        ];
        let allFleets = [
            {name: "scout_ship", count: 0, power: game.actions.galaxy.gxy_gateway.scout_ship.ship.rating()},
            {name: "corvette_ship", count: 0, power: game.actions.galaxy.gxy_gateway.corvette_ship.ship.rating()},
            {name: "frigate_ship", count: 0, power: game.actions.galaxy.gxy_gateway.frigate_ship.ship.rating()},
            {name: "cruiser_ship", count: 0, power: game.actions.galaxy.gxy_gateway.cruiser_ship.ship.rating()},
            {name: "dreadnought", count: 0, power: game.actions.galaxy.gxy_gateway.dreadnought.ship.rating()},
        ];
        let minPower = allFleets[0].power;

        // We can't rely on stateOnCount - it won't give us correct number of ships of some of them missing crew
        let fleetIndex = Object.fromEntries(allFleets.map((ship, index) => [ship.name, index]));
        Object.values(def).forEach(assigned => Object.entries(assigned).forEach(([ship, count]) => allFleets[fleetIndex[ship]].count += Math.floor(count)));

        // Check if we can perform assault mission
        let assault = null;
        if (buildings.ChthonianMission.isUnlocked() && settings.fleetChthonianLoses !== "ignore") {
            let fleetReq, fleetWreck;
            if (settings.fleetChthonianLoses === "low") {
                fleetReq = 4500;
                fleetWreck = 80;
            } else if (settings.fleetChthonianLoses === "avg") {
                fleetReq = 2500;
                fleetWreck = 160;
            } else if (settings.fleetChthonianLoses === "high") {
                fleetReq = 1250;
                fleetWreck = 500;
            } else if (settings.fleetChthonianLoses === "dread") {
                if (allFleets[4].count > 0) {
                    assault = {ships: [0,0,0,0,1], region: "gxy_chthonian", mission: buildings.ChthonianMission};
                }
            } else if (settings.fleetChthonianLoses === "frigate") {
                let totalPower = allFleets.reduce((sum, ship) => sum + (ship.power >= allFleets[2].power ? ship.power * ship.count : 0), 0);
                if (totalPower >= 4500) {
                    assault = {ships: allFleets.map((ship, idx) => idx >= 2 ? ship.count : 0), region: "gxy_chthonian", mission: buildings.ChthonianMission};
                }
            }
            if (game.global.race['instinct']) {
                fleetWreck /= 2;
            }

            let availableShips = allFleets.map(ship => ship.count);
            let powerToReserve = fleetReq - fleetWreck;
            for (let i = availableShips.length - 1; i >= 0 && powerToReserve > 0; i--) {
                let reservedShips = Math.min(availableShips[i], Math.ceil(powerToReserve / allFleets[i].power));
                availableShips[i] -= reservedShips;
                powerToReserve -= reservedShips * allFleets[i].power;
            }
            if (powerToReserve <= 0) {
                let sets = availableShips.map((amount, idx) => [...Array(Math.min(amount, Math.floor((fleetWreck + (minPower - 0.1)) / allFleets[idx].power)) + 1).keys()]);
                for (let set of cartesian(...sets)) {
                    let powerMissing = fleetWreck - set.reduce((sum, amt, idx) => sum + amt * allFleets[idx].power, 0);
                    if (powerMissing <= 0 && powerMissing > minPower * -1) {
                        let lastShip = set.reduce((prev, val, cur) => val > 0 ? cur : prev, 0);
                        let team = allFleets.map((ship, idx) => idx >= lastShip ? ship.count : set[idx]);
                        assault = {ships: team, region: "gxy_chthonian", mission: buildings.ChthonianMission};
                        break;
                    }
                }
            }
        } else if (buildings.Alien2Mission.isUnlocked() && resources.Knowledge.maxQuantity >= settings.fleetAlien2Knowledge) {
            let totalPower = allFleets.reduce((sum, ship) => sum + (ship.power * ship.count), 0);

            let doAlien2Assault = false;
            if (settings.fleetAlien2Loses === "suicide") {
                doAlien2Assault = totalPower >= 400;
            } else {
                doAlien2Assault = totalPower >= 650;
            }

            if (doAlien2Assault) {
                assault = {ships: allFleets.map(ship => ship.count), region: "gxy_alien2", mission: buildings.Alien2Mission};
            }
        }
        if (assault) {
            // Unassign all ships from where there're assigned currently
            Object.entries(def).forEach(([region, assigned]) => Object.entries(assigned).forEach(([ship, count]) => FleetManager.subShip(region, ship, count)));
            // Assign to target region
            allFleets.forEach((ship, idx) => FleetManager.addShip(assault.region, ship.name, assault.ships[idx]));
            assault.mission.click();
            return; // We're done for now; lot of data was invalidated during attack, we'll manage remaining ships in next tick
        }

        let regionsToProtect = allRegions.filter(region => region.useful && region.piracy - region.armada > 0);

        for (let i = 0; i < allRegions.length; i++) {
            let region = allRegions[i];
            region.priority = settings["fleet_pr_" + region.name];
            region.assigned = {};
            for (let j = 0; j < allFleets.length; j++) {
                region.assigned[allFleets[j].name] = 0;
            }
        }

        // Calculate min allowed coverage, if we have more ships than we can allocate without overflowing.
        let missingDef = regionsToProtect.map(region => region.piracy - region.armada);
        for (let i = allFleets.length - 1; i >= 0; i--) {
            let ship = allFleets[i];
            let maxAllocate = missingDef.reduce((sum, def) => sum + Math.floor(def / ship.power), 0);
            if (ship.count > maxAllocate) {
                if (ship.count >= maxAllocate + missingDef.length) {
                    ship.cover = 0;
                } else {
                    let overflows = missingDef.map(def => def % ship.power).sort((a, b) => b - a);
                    ship.cover = overflows[ship.count - maxAllocate - 1];
                }
            } else {
                ship.cover = ship.power - (minPower - 0.1);
            }
            if (ship.count >= maxAllocate) {
                missingDef.forEach((def, idx, arr) => arr[idx] = def % ship.power);
                if (ship.count > maxAllocate) {
                    missingDef.sort((a, b) => b - a);
                    for (let j = 0; j < ship.count - maxAllocate; j++) {
                        missingDef[j] = 0;
                    }
                }
            }
        }
        for (let i = 0; i < allFleets.length; i++){
            if (allFleets[i].count > 0) {
                allFleets[i].cover = 0.1;
                break;
            }
        }

        // Calculate actual amount of ships per zone
        let priorityList = regionsToProtect.sort((a, b) => a.priority - b.priority);
        for (let i = 0; i < priorityList.length; i++) {
            let region = priorityList[i];
            let missingDef = region.piracy - region.armada;

            // First pass, try to assign ships without overuse (unless we have enough ships to overuse everything)
            for (let k = allFleets.length - 1; k >= 0 && missingDef > 0; k--) {
                let ship = allFleets[k];
                if (ship.cover <= missingDef) {
                    let shipsToAssign = Math.min(ship.count, Math.floor(missingDef / ship.power));
                    if (shipsToAssign < ship.count && shipsToAssign * ship.power + ship.cover <= missingDef) {
                        shipsToAssign++;
                    }
                    region.assigned[ship.name] += shipsToAssign;
                    ship.count -= shipsToAssign;
                    missingDef -= shipsToAssign * ship.power;
                }
            }

            if (settings.fleetMaxCover && missingDef > 0) {
                // Second pass, try to fill remaining gaps, if wasteful overuse is allowed
                let index = -1;
                while (missingDef > 0 && ++index < allFleets.length) {
                    let ship = allFleets[index];
                    if (ship.count > 0) {
                        let shipsToAssign = Math.min(ship.count, Math.ceil(missingDef / ship.power));
                        region.assigned[ship.name] += shipsToAssign;
                        ship.count -= shipsToAssign;
                        missingDef -= shipsToAssign * ship.power;
                    }
                }

                // If we're still missing defense it means we have no more ships to assign
                if (missingDef > 0) {
                    break;
                }

                // Third pass, retrive ships which not needed after second pass
                while (--index >= 0) {
                    let ship = allFleets[index];
                    if (region.assigned[ship.name] > 0 && missingDef + ship.power <= 0) {
                        let uselesShips = Math.min(region.assigned[ship.name], Math.floor(missingDef / ship.power * -1));
                        if (uselesShips > 0) {
                            region.assigned[ship.name] -= uselesShips;
                            ship.count += uselesShips;
                            missingDef += uselesShips * ship.power;
                        }
                    }
                }
            }
        }

        // Assign remaining ships to gorddon, to utilize Symposium
        if (buildings.GorddonSymposium.stateOnCount > 0) {
            allFleets.forEach(ship => allRegions[2].assigned[ship.name] += ship.count);
        }

        let shipDeltas = allRegions.map(region => Object.entries(region.assigned).map(([ship, count]) => [ship, count - def[region.name][ship]]));

        shipDeltas.forEach((ships, region) => ships.forEach(([ship, delta]) => delta < 0 && FleetManager.subShip(allRegions[region].name, ship, delta * -1)));
        shipDeltas.forEach((ships, region) => ships.forEach(([ship, delta]) => delta > 0 && FleetManager.addShip(allRegions[region].name, ship, delta)));
    }

    function autoMech() {
        let m = MechManager;
        if (!m.initLab() || $(`#mechList .mechRow[draggable=true]`).length > 0) {
            return;
        }
        let mechBay = game.global.portal.mechbay;
        let prolongActive = m.isActive;
        m.isActive = false;
        let savingSupply = m.saveSupply && settings.mechBaysFirst && buildings.SpirePurifier.stateOffCount === 0;
        m.saveSupply = false;

        // Rearrange mechs for best efficiency if some of the bays are disabled
        if (m.inactiveMechs.length > 0) {
            // Each drag redraw mechs list, do it just once per tick to reduce stress
            if (m.activeMechs.length > 0) {
                m.activeMechs.sort((a, b) => a.efficiency - b.efficiency);
                m.inactiveMechs.sort((a, b) => b.efficiency - a.efficiency);
                if (m.activeMechs[0].efficiency < m.inactiveMechs[0].efficiency) {
                    if (m.activeMechs.length > m.inactiveMechs.length) {
                        m.dragMech(m.activeMechs[0].id, mechBay.mechs.length - 1);
                    } else {
                        m.dragMech(m.inactiveMechs[0].id, 0);
                    }
                }
            }
            return; // Can't do much while having disabled mechs, without scrapping them all. And that's really bad idea. Just wait until bays will be enabled back.
        }

        if (haveTask("mech")) {
            return; // Do nothing except dragging if governor enabled
        }

        let newMech = {};
        let newSize, forceBuild;
        if (settings.mechBuild === "random") {
            [newSize, forceBuild] = m.getPreferredSize();
            newMech = m.getRandomMech(newSize);
        } else if (settings.mechBuild === "user") {
            newMech = {...mechBay.blueprint, ...m.getMechStats(mechBay.blueprint)};
        } else { // mechBuild === "none"
            return; // Mech build disabled, stop here
        }
        let [newGems, newSupply, newSpace] = m.getMechCost(newMech);

        if (!settings.mechFillBay && resources.Supply.spareMaxQuantity < newSupply) {
            return; // Not enough supply capacity, and smaller mechs are disabled, can't do anything
        }

        let baySpace = mechBay.max - mechBay.bay;
        let lastFloor = settings.autoPrestige && settings.prestigeType === "demonic" && buildings.SpireTower.count >= settings.prestigeDemonicFloor && haveTech("waygate", 3);
        if (lastFloor) {
            savingSupply = false;
        }

        // Save up supply for next floor
        if (settings.mechSaveSupplyRatio > 0 && !lastFloor && !forceBuild) {
            let missingSupplies = (resources.Supply.maxQuantity * settings.mechSaveSupplyRatio) - resources.Supply.currentQuantity;
            if (baySpace < newSpace) {
                missingSupplies -= m.getMechRefund({size: "titan"})[1];
            }
            let timeToFullSupplies = missingSupplies / resources.Supply.rateOfChange;
            if (m.getTimeToClear() <= timeToFullSupplies) {
                return; // Floor will be cleared before capping supplies, save them
            }
        }

        let canExpandBay = settings.autoBuild && settings.mechBaysFirst && buildings.SpireMechBay.isAutoBuildable() && (buildings.SpireMechBay.isAffordable(true) || (buildings.SpirePurifier.isAutoBuildable() && buildings.SpirePurifier.isAffordable(true) && buildings.SpirePurifier.stateOffCount === 0));
        let mechScrap = settings.mechScrap;
        if (canExpandBay && resources.Supply.currentQuantity < resources.Supply.maxQuantity && !prolongActive && resources.Supply.rateOfChange >= settings.mechMinSupply) {
            // We can build purifier or bay once we'll have enough resources, do not rebuild old mechs
            // Unless floor just changed, and scrap income fall to low, so we need to rebuild them to fix it
            mechScrap = "none";
        } else if (settings.mechScrap === "mixed") {
            if (buildings.SpireWaygate.stateOnCount === 1) {
                // No mass scrapping during Demon Lord fight, all mechs equially good here - stay with full bay
                mechScrap = "single";
            } else {
                let mechToBuild = Math.floor(baySpace / newSpace);
                // If we're going to save up supplies we need to reserve time for it
                let supplyCost = (mechToBuild * newSupply) + (resources.Supply.maxQuantity * settings.mechSaveSupplyRatio);
                let timeToFullBay = Math.max((supplyCost - resources.Supply.currentQuantity) / resources.Supply.rateOfChange,
                              (mechToBuild * newGems - resources.Soul_Gem.currentQuantity) / resources.Soul_Gem.rateOfChange);
                // timeToClear changes drastically with new mechs, let's try to normalize it, scaling it with available power
                let estimatedTotalPower = m.mechsPower + mechToBuild * newMech.power;
                let estimatedTimeToClear = m.getTimeToClear() * (m.mechsPower / estimatedTotalPower);
                mechScrap = timeToFullBay > estimatedTimeToClear && !lastFloor ? "single" : "all";
            }
        }

        // Check if we need to scrap anything
        if (newSupply < resources.Supply.spareMaxQuantity && ((mechScrap === "single" && baySpace < newSpace) || (mechScrap === "all" && (baySpace < newSpace || resources.Supply.spareQuantity < newSupply || resources.Soul_Gem.spareQuantity < newGems)))) {
            let spaceGained = 0;
            let supplyGained = 0;
            let gemsGained = 0;
            let powerLost = 0;

            // Get list of inefficient mech
            let scrapEfficiency =
              (settings.mechFillBay ? baySpace === 0 : baySpace < newSpace) && resources.Supply.storageRatio > 0.9 && !savingSupply ? 0 :
              lastFloor ? Math.min(settings.mechScrapEfficiency, 1) :
              settings.mechScrapEfficiency;

            let badMechList = m.activeMechs.filter(mech => {
                if ((mech.infernal && mech.size !== 'collector') || mech.power >= m.bestMech[mech.size].power) {
                    return false;
                }
                if (forceBuild) { // Get everything that isn't infernal or 100% optimal for force rebuild
                    return true;
                }
                let [gemRefund, supplyRefund] = m.getMechRefund(mech);
                // Collector and scout does not refund gems. Let's pretend they're returning half of gem during filtering
                let costRatio = Math.min((gemRefund || 0.5) / newGems, supplyRefund / newSupply);
                let powerRatio = mech.power / newMech.power;
                return costRatio / powerRatio > scrapEfficiency;
            }).sort((a, b) => a.efficiency - b.efficiency);

            let extraScouts = settings.mechScoutsRebuild ? Number.MAX_SAFE_INTEGER : mechBay.scouts - (mechBay.max * settings.mechScouts / 2);

            // Remove worst mechs untill we have enough room for new mech
            let trashMechs = [];
            for (let i = 0; i < badMechList.length && (baySpace + spaceGained < newSpace || (mechScrap === "all" && (resources.Supply.spareQuantity + supplyGained < newSupply || resources.Soul_Gem.spareQuantity + gemsGained < newGems))); i++) {
                if (badMechList[i].size === 'small') {
                    if (extraScouts < 1) {
                        continue;
                    } else {
                        extraScouts--;
                    }
                }
                spaceGained += m.getMechSpace(badMechList[i]);
                supplyGained += m.getMechRefund(badMechList[i])[1];
                gemsGained += m.getMechRefund(badMechList[i])[0];
                powerLost += badMechList[i].power;
                trashMechs.push(badMechList[i]);
            }

            // Now go scrapping, if possible and benefical
            if (trashMechs.length > 0 && (forceBuild || powerLost / spaceGained < newMech.efficiency) && baySpace + spaceGained >= newSpace && resources.Supply.spareQuantity + supplyGained >= newSupply && resources.Soul_Gem.spareQuantity + gemsGained >= newGems) {
                trashMechs.sort((a, b) => b.id - a.id); // Goes from bottom to top of the list, so it won't shift IDs
                if (trashMechs.length > 1) {
                    let rating = average(trashMechs.map(mech => mech.power / m.bestMech[mech.size].power));
                    GameLog.logSuccess("mech_scrap", `${trashMechs.length} mechs (~${Math.round(rating * 100)}%) has been scrapped.`, ['hell']);
                } else {
                    GameLog.logSuccess("mech_scrap", `${m.mechDesc(trashMechs[0])} mech has been scrapped.`, ['hell']);
                }
                trashMechs.forEach(mech => m.scrapMech(mech));
                resources.Supply.currentQuantity = Math.min(resources.Supply.currentQuantity + supplyGained, resources.Supply.maxQuantity);
                resources.Soul_Gem.currentQuantity += gemsGained;
                baySpace += spaceGained;
            } else if (baySpace + spaceGained >= newSpace) {
                return; // We have scrapable mechs, but don't want to scrap them right now. Waiting for more supplies for instant replace.
            }
        }

        // Try to squeeze smaller mech, if we can't fit preferred one
        if (settings.mechFillBay && !savingSupply && ((!canExpandBay && baySpace < newSpace) || resources.Supply.maxQuantity < newSupply)) {
            for (let i = m.Size.indexOf(newMech.size) - 1; i >= 0; i--) {
                [newGems, newSupply, newSpace] = m.getMechCost({size: m.Size[i]});
                if (newSpace <= baySpace && newSupply <= resources.Supply.maxQuantity) {
                    newMech = m.getRandomMech(m.Size[i]);
                    break;
                }
            }
        }

        // We have everything to get new mech
        if (resources.Soul_Gem.spareQuantity >= newGems && resources.Supply.spareQuantity >= newSupply && baySpace >= newSpace) {
            m.buildMech(newMech);
            resources.Supply.currentQuantity -= newSupply;
            resources.Soul_Gem.currentQuantity -= newGems;
            m.isActive = prolongActive;
            return;
        }
    }

    function updateScriptData() {
        for (let id in resources) {
            resources[id].updateData();
        }
        updateCraftCost();
        WarManager.updateGarrison();
        WarManager.updateHell();
        MarketManager.updateData();
        BuildingManager.updateBuildings();

        // Parse global production modifiers
        state.globalProductionModifier = 1;
        for (let mod of Object.values(game.breakdown.p.Global ?? {})) {
            state.globalProductionModifier *= 1 + (parseFloat(mod) || 0) / 100;
        }
    }

    function finalizeScriptData() {
        SpyManager.updateForeigns();
        for (let id in resources) {
            resources[id].finalizeData();
        }
        EjectManager.updateResources();
        SupplyManager.updateResources();
        NaniteManager.updateResources();

        // Money is special. They aren't defined as tradable, but still affected by trades
        if (settings.autoMarket) {
            let tradeDiff = game.breakdown.p.consume["Money"]?.Trade || 0;
            if (tradeDiff > 0) {
                resources.Money.rateMods['buy'] = tradeDiff * -1;
            } else if (tradeDiff < 0) {
                resources.Money.rateMods['sell'] = tradeDiff * -1;
                resources.Money.rateOfChange += resources.Money.rateMods['sell'];
            }
        }
        if (settings.autoPylon && RitualManager.initIndustry()) {
            Object.values(RitualManager.Productions)
              .filter(spell => spell.isUnlocked())
              .forEach(spell => resources.Mana.rateOfChange += RitualManager.spellCost(spell));
        }

        // Add clicking to rate of change, so we can sell or eject it.
        if (settings.buildingAlwaysClick || (settings.autoBuild && (resources.Population.currentQuantity <= 15 || (buildings.RockQuarry.count < 1 && !game.global.race['sappy'])))) {
            let resPerClick = getResourcesPerClick() * ticksPerSecond();
            let conjureMod = haveTech("conjuring", 2) ? 10 : 1;
            if (buildings.Food.isClickable()) {
                resources.Food.rateOfChange += resPerClick * settings.buildingClickPerTick * conjureMod;
            }
            if (buildings.Lumber.isClickable()) {
                resources.Lumber.rateOfChange += resPerClick * settings.buildingClickPerTick  * conjureMod;
            }
            if (buildings.Stone.isClickable()) {
                resources.Stone.rateOfChange += resPerClick * settings.buildingClickPerTick  * conjureMod;
            }
            if (buildings.Chrysotile.isClickable()) {
                resources.Chrysotile.rateOfChange += resPerClick * settings.buildingClickPerTick  * conjureMod;
            }
            if (buildings.Slaughter.isClickable()){
                resources.Lumber.rateOfChange += resPerClick * settings.buildingClickPerTick;
                if (game.global.race['soul_eater'] && haveTech("primitive", 2)){
                    resources.Food.rateOfChange += resPerClick * settings.buildingClickPerTick;
                }
                if (resources.Furs.isUnlocked()) {
                    resources.Furs.rateOfChange += resPerClick * settings.buildingClickPerTick;
                }
            }
        }
    }

    function requestStorageFor(list) {
        // Required amount increased by 3% from actual numbers, as other logic of script can and will try to prevent overflowing by selling\ejecting\building projects, and that might cause an issues if we'd need 100% of storage
        let bufferMult = settings.storageAssignExtra ? 1.03 : 1;
        listLoop:
        for (let i = 0; i < list.length; i++) {
            let obj = list[i];
            let storageSuffient = true;
            for (let res in obj.cost) {
                resources[res].maxCost = Math.max(obj.cost[res], resources[res].maxCost);

                if (resources[res].maxQuantity < obj.cost[res] && !resources[res].hasStorage()) {
                    storageSuffient = false;
                }
            }
            if (!storageSuffient) {
                continue listLoop;
            }
            for (let res in obj.cost) {
                let assumeCost = obj.cost[res] * bufferMult;
                if (resources[res].maxQuantity < assumeCost && !resources[res].hasStorage()) {
                    assumeCost = (obj.cost[res] + resources[res].maxQuantity) / 2;
                }
                resources[res].storageRequired = Math.max(assumeCost, resources[res].storageRequired);
            }
        }
    }

    function calculateRequiredStorages() {
        // We need to preserve amount of knowledge required by techs only, while amount still not polluted
        // by buildings - wardenclyffe, labs, etc. This way we can determine what's our real demand is.
        // Otherwise they might start build up knowledge cap just to afford themselves, increasing required
        // cap further, so we'll need more labs, and they'll demand even more knowledge for next level and so on.
        state.knowledgeRequiredByTechs = Math.max(0, ...state.unlockedTechs.map(tech => tech.cost["Knowledge"] ?? 0));

        if (buildings.GorddonEmbassy.isAutoBuildable()) {
            state.knowledgeRequiredByTechs = Math.max(state.knowledgeRequiredByTechs, settings.fleetEmbassyKnowledge);
        }

        // Get list of all objects and techs, and find biggest numbers for each resource
        if (settings.autoFleet && FleetManagerOuter.nextShipExpandable && settings.prioritizeOuterFleet !== "ignore") {
            requestStorageFor([{cost: FleetManagerOuter.nextShipCost}]);
        }
        requestStorageFor(state.unlockedTechs);
        requestStorageFor(state.queuedTargetsAll);
        requestStorageFor(BuildingManager.priorityList.filter((b) => b.isUnlocked() && b.autoBuildEnabled));
        requestStorageFor(ProjectManager.priorityList.filter((p) => p.isUnlocked() && p.autoBuildEnabled));

        // Increase storage for sellable resources, to make sure we'll have required amount before they'll be sold
        if (settings.storageAssignExtra && !game.global.race['no_trade'] && settings.autoMarket) {
            for (let id in resources) {
                if (resources[id].autoSellEnabled && resources[id].autoSellRatio > 0) {
                    resources[id].storageRequired /= resources[id].autoSellRatio;
                }
            }
        }
    }

    function prioritizeDemandedResources() {
        let prioritizedTasks = [];
        // Building and research queues
        if (settings.prioritizeQueue.includes("req")) {
            prioritizedTasks.push(...state.queuedTargets);
        }
        // Active triggers
        if (settings.prioritizeTriggers.includes("req")) {
            prioritizedTasks.push(...state.triggerTargets);
        }
        if (settings.autoTrigger && settings.prioritizeAdvTriggerHigh.includes("req")) {
            prioritizedTasks.push(...AdvTriggerManager.activeHighPriorityTriggers);
        }
        if (settings.autoTrigger && settings.prioritizeAdvTriggerLow.includes("req")) {
            prioritizedTasks.push(...AdvTriggerManager.activeLowPriorityTriggers);
        }
        // Unlocked missions
        if (settings.missionRequest) {
            for (let i = state.missionBuildingList.length - 1; i >= 0; i--) {
                let mission = state.missionBuildingList[i];
                if (mission.isUnlocked() && mission.autoBuildEnabled && (mission !== buildings.BlackholeJumpShip || !settings.prestigeBioseedConstruct || settings.prestigeType !== "whitehole")) {
                    prioritizedTasks.push(mission);
                } else if (mission.isComplete()) { // Mission finished, remove it from list
                    state.missionBuildingList.splice(i, 1);
                }
            }
        }

        // Unlocked and affordable techs, but only if we don't have anything more important
        if (prioritizedTasks.length === 0 && (isEarlyGame() ? settings.researchRequest : settings.researchRequestSpace)) {
            prioritizedTasks = state.unlockedTechs.filter(t => t.isAffordable(true));
        }

        if (prioritizedTasks.length > 0) {
            for (let i = 0; i < prioritizedTasks.length; i++){
                let demandedObject = prioritizedTasks[i];
                for (let res in demandedObject.cost) {
                    let resource = resources[res];
                    let quantity = demandedObject.cost[res];
                    // Double request for project, to make it smoother
                    if (demandedObject instanceof Project && demandedObject.progress < 99) {
                        quantity *= 2;
                    }
                    resource.requestedQuantity = Math.max(resource.requestedQuantity, quantity);
                }
            }
        }

        // Request money for unification
        if (SpyManager.purchaseMoney && settings.prioritizeUnify.includes("req")) {
            resources.Money.requestedQuantity = Math.max(resources.Money.requestedQuantity, SpyManager.purchaseMoney);
        }

        if (settings.autoFleet && FleetManagerOuter.nextShipAffordable && settings.prioritizeOuterFleet.includes("req")) {
            for (let res in FleetManagerOuter.nextShipCost) {
                let resource = resources[res];
                resource.requestedQuantity = Math.max(resource.requestedQuantity, FleetManagerOuter.nextShipCost[res]);
            }
        }

        // Prioritize material for craftables
        let availableCrafters = JobManager.craftingMax() + JobManager.skilledServantsMax();
        for (let id in resources) {
            let resource = resources[id];
            if (resource.isDemanded()) {
                // Only craftables stores their cost, no need for additional checks
                for (let res in resource.cost) {
                    let material = resources[res];
                    // Add craftPreserve, plus minimum consumption:
                    // Craftsmen use 1/140 of game's given cost base per tick, before Crafty
                    // Demand 60s worth of production if we were to put all crafters on this resource (effectively 30s with Crafty)
                    let minExpected = (material.maxQuantity * resource.craftPreserve) + (availableCrafters * (1/140) * 60 * resource.cost[res]);
                    material.requestedQuantity = Math.max(material.requestedQuantity, minExpected);
                }
            }
        }

        // Prioritize some factory materials when needed
        let factoryThreshold = settings.productionFactoryMinIngredients + 0.01;
        if (resources.Stanene.isDemanded() && resources.Nano_Tube.storageRatio < factoryThreshold) {
            resources.Nano_Tube.requestedQuantity = Math.max(resources.Nano_Tube.requestedQuantity, resources.Nano_Tube.maxQuantity * factoryThreshold);
        }
        if (resources.Nano_Tube.isDemanded() && resources.Coal.storageRatio < factoryThreshold) {
            resources.Coal.requestedQuantity = Math.max(resources.Coal.requestedQuantity, resources.Coal.maxQuantity * factoryThreshold);
        }
        if (resources.Furs.isDemanded() && resources.Polymer.storageRatio < factoryThreshold) {
            resources.Polymer.requestedQuantity = Math.max(resources.Polymer.requestedQuantity, resources.Polymer.maxQuantity * factoryThreshold);
        }
        // TODO: Prioritize missing consumptions of buildings
        // Force crafting Stanene when there's less than minute worths of consumption, or 5%
        if (buildings.Alien1VitreloyPlant.count > 0 && resources.Stanene.currentQuantity < Math.min((buildings.Alien1VitreloyPlant.count || 1) * 6000, resources.Stanene.maxQuantity * 0.05)) {
            resources.Stanene.requestedQuantity = resources.Stanene.maxQuantity;
        }
    }

    function updatePriorityTargets() {
        state.conflictTargets = [];
        state.queuedTargets = [];
        state.queuedTargetsAll = [];
        state.triggerTargets = [];
        state.unlockedTechs = [];
        state.unlockedBuildings = [];

        // Building and research queues
        let queueSave = settings.prioritizeQueue.includes("save");
        [{type: "queue", noorder: "qAny", map: (id) => buildingIds[id] || arpaIds[id]},
         {type: "r_queue", noorder: "qAny_res", map: (id) => techIds[id]}].forEach(queue => {
            if (game.global[queue.type].display) {
                for (let item of game.global[queue.type].queue) {
                    let obj = queue.map(item.id);
                    if (obj) {
                        state.queuedTargetsAll.push(obj);
                        if (obj.isAffordable(true)) {
                            state.queuedTargets.push(obj);
                            if (queueSave) {
                                state.conflictTargets.push({name: obj.title, cause: "Queue", cost: obj.cost});
                            }
                        }
                    }
                    if (!game.global.settings[queue.noorder]) {
                        break;
                    }
                }
            }
        });

        if (SpyManager.purchaseMoney && settings.prioritizeUnify.includes("save")) {
            state.conflictTargets.push({name: techIds["tech-unification"].title, cause: "Purchase", cost: {Money: SpyManager.purchaseMoney}});
        }

        if (settings.autoFleet && FleetManagerOuter.nextShipAffordable && settings.prioritizeOuterFleet.includes("save")) {
            state.conflictTargets.push({name: FleetManagerOuter.nextShipName, cause: "Ship", cost: FleetManagerOuter.nextShipCost});
        }

        if (settings.autoTrigger) {
            TriggerManager.resetTargetTriggers();
            let triggerSave = settings.prioritizeTriggers.includes("save");

            // Active triggers
            for (let trigger of TriggerManager.targetTriggers) {
                let id = trigger.actionId;
                let obj = arpaIds[id] || buildingIds[id] || techIds[id];
                if (obj) {
                    state.triggerTargets.push(obj);
                    if (triggerSave) {
                        state.conflictTargets.push({name: obj.title, cause: "Trigger", cost: obj.cost});
                    }
                }
            }
        }

        // TODO: Make own toggle for this, and make save/req behavior configurable
        if (settings.autoTrigger) {
            AdvTriggerManager.updateAll();

            for (let trg of AdvTriggerManager.activeHighPriorityTriggers) {
                if (trg.actionTarget) {
                    state.triggerTargets.push(trg.actionTarget);
                    state.conflictTargets.push({ name: trg.actionTarget.title, cause: "AdvTrigger", cost: trg.actionTarget.cost });
                }
            }

            for (let trg of AdvTriggerManager.activeLowPriorityTriggers) {
                if (trg.actionTarget) {
                    state.triggerTargets.push(trg.actionTarget);
                    state.conflictTargets.push({ name: trg.actionTarget.title, cause: "AdvTrigger", cost: trg.actionTarget.cost });
                }
            }
        }

        // Fake trigger for Embassy
        if (buildings.GorddonEmbassy.isAutoBuildable() && resources.Knowledge.maxQuantity >= settings.fleetEmbassyKnowledge) {
            let obj = buildings.GorddonEmbassy;
            state.triggerTargets.push(obj);
            state.conflictTargets.push({name: obj.title, cause: "Knowledge", cost: obj.cost});
        }
        // Fake trigger for Eden
        if (buildings.TauStarEden.isAutoBuildable() && isPrestigeAllowed("eden")) {
            let obj = buildings.TauStarEden;
            state.triggerTargets.push(obj);
            state.conflictTargets.push({name: obj.title, cause: "Prestige", cost: obj.cost});
        }
        // Fake trigger for Ignition
        if (buildings.TauGas2MatrioshkaBrain.count >= 1000 && buildings.TauGas2IgniteGasGiant.isAutoBuildable() && isPrestigeAllowed("retire")) {
            let obj = buildings.TauGas2IgniteGasGiant;
            state.triggerTargets.push(obj);
            state.conflictTargets.push({name: obj.title, cause: "Prestige", cost: obj.cost});
        }

        $("#tech .action").each(function() {
            let tech = techIds[this.id];
            tech.updateResourceRequirements();
            if (!getTechConflict(tech) || state.triggerTargets.includes(tech) || state.queuedTargetsAll.includes(tech)) {
                state.unlockedTechs.push(tech);
            }
        });
    }

    function checkEvolutionResult() {
        if (!settings.masterScriptToggle || !state.evoCheckNeeded) {
            return true;
        }
        state.evoCheckNeeded = false;

        let needReset = false;
        if (settings.autoEvolution && settings.evolutionBackup) {
            // Sludge and Valdi can't be evolved at random, only intentionally
            if (game.global.race.species !== "junker" && game.global.race.species !== "sludge") {
                if (settings.userEvolutionTarget === "auto") {
                    let newRace = races[game.global.race.species];
                    if (newRace.getWeighting() <= 0) {
                        let bestWeighting = Math.max(...Object.values(races).map(r => r.getWeighting()));
                        if (bestWeighting > 0) {
                            GameLog.logDanger("special", `${newRace.name} have no unearned achievements for current prestige, soft resetting and trying again.`, ['progress', 'achievements']);
                            needReset = true;
                        } else {
                            GameLog.logWarning("special", `Can't pick a race with unearned achievements for current prestige. Continuing with ${newRace.name}.`, ['progress', 'achievements']);
                        }
                    }
                } else if (settings.userEvolutionTarget !== game.global.race.species && races[settings.userEvolutionTarget].getHabitability() > 0) {
                    GameLog.logDanger("special", `Wrong race, soft resetting and trying again.`, ['progress']);
                    needReset = true;
                }
            }
        }
        if (settings.autoMutateTraits) {
            let baseRace = game.races[game.global.race.species];
            for (let trait of MutableTraitManager.priorityList) {
                if (trait.resetEnabled && game.global.race[trait.traitName] && !baseRace.traits[trait.traitName]) {
                    GameLog.logDanger("special", `Gained ${trait.name} trait, soft resetting and trying again.`, ['progress']);
                    needReset = true;
                    break;
                }
            }
        }

        if (needReset) {
            // Let's double check it's actually *soft* reset
            let resetButton = document.querySelector(".reset .button:not(.right)");
            if (resetButton.innerText === game.loc("reset_soft")) {
                if (settings.evolutionQueueEnabled && settingsRaw.evolutionQueue.length > 0) {
                    if (!settings.evolutionQueueRepeat) {
                        addEvolutionSetting();
                    }
                    settingsRaw.evolutionQueue.unshift(settingsRaw.evolutionQueue.pop());
                }
                updateSettingsFromState();

                state.goal = "GameOverMan";
                resetButton.disabled = false;
                resetButton.click();
                return false;
            }
        }
        return true;
    }

    // TODO: quantium lab
    function updateTabs(update) {
        let oldHash = state.tabHash;
        state.tabHash = 0 // Not really a hash, but it should never go down, that's enough to track unlocks. (Except market after mutation in terrifying, 1000 weight should prevent all possible issues)
          + (game.global.race['smoldering'] && buildings.RockQuarry.count ? 1 : 0) // Chrysotile production
          + (game.global.race['shapeshifter'] ? 1 : 0) // Shifter UI
          + (game.global.race['servants'] ? 1 : 0) // Servants UI
          + (game.global.settings.showMarket ? 1000 : 0) // Market tab unlocked
          + (game.global.galaxy.trade ? 1 : 0) // Galaxy trades unlocked
          + (game.global.settings.showEjector ? 1 : 0) // Ejector tab unlocked
          + (game.global.settings.showCargo ? 1 : 0) // Supply tab unlocked
          + (game.global.tech.alchemy ?? 0) // Basic & advanced transmutations
          + (game.global.tech.queue ? 1 : 0) // Queue unlocked
          + (game.global.tech.r_queue ? 1 : 0) // Research queue unlocked
          + (game.global.tech.govern ? 1 : 0) // Government unlocked
          + (game.global.tech.trade ? 1 : 0) // Trade Routes unlocked
          + (resources.Crates.isUnlocked() ? 1 : 0) // Crates in storage tab
          + (resources.Containers.isUnlocked() ? 1 : 0) // Containers in storage tab
          + (game.global.tech.m_smelting >= 2 ? 1 : 0) // TP Iridium smelting
          + (game.global.tech.irid_smelting ? 1 : 0) // Iridium smelting
          + (buildings.TitanQuarters.count > 0 ? 1 : 0) // Titan Mine unlocked
          + (game.global.race['orbit_decayed'] ? 1 : 0) // City tab gone
          + (game.global.tech.womling_tech ?? 0) // Womling techs
          + (game.global.tech.focus_cure ?? 0) // Cure techs
          + (game.global.tech.isolation ? 1 : 0) // Solar tabs gone
          + (game.global.tech.m_ignite ? 1 : 0) // Ignition Device built
          + (buildings.TauStarRingworld.count >= 1000 ? 1 : 0) // Ringworld built
          + (game.global.tech.tau_gas2 >= 5 ? 1 : 0) // Alien Space Station built
          + (game.global.tech.replicator ? 1 : 0) // Matter Replicator unlocked
          + (game.global.tauceti.tau_factory?.count > 0 ? 1 : 0) // Factory built in lone survivor
          + (game.global.space.g_factory?.count > 0 ? 1 : 0) // Graphene plant built in lone survivor
          + (game.global.tauceti.mining_ship?.count > 0 ? 1 : 0) // Extractor ship built
          + (game.global.tech.psychicthrall ?? 0) // Psychic powers
          + (game.global.tech.psychic ?? 0) // Psychic powers


        if (game.global.settings.showShipYard) { // TP Ship Yard
          state.tabHash += 1
            + (game.global.tech.syard_class ?? 0) // Tiers of unlocked components
            + (game.global.tech.syard_power ?? 0)
            + (game.global.tech.syard_weapon ?? 0)
            + (game.global.tech.syard_armor ?? 0)
            + (game.global.tech.syard_engine ?? 0)
            + (game.global.tech.syard_sensor ?? 0)
            + (haveTech('titan', 3) && haveTech('enceladus', 2) ? 1 : 0) // Enceladus syndicate
            + (haveTech('triton', 2) ? 1 : 0) // Triton syndicate
            + (haveTech('kuiper') ? 1 : 0) // Kuiper syndicate
            + (haveTech('eris') ? 1 : 0) // Eris syndicate
            + (haveTech('titan_ai_core') ? 1 : 0) // AI core built, drones unlocked
            + (haveTech('tauceti') ? 1 : 0); // Interstellar drive researched, explorer inlocked

        }

        if (game.global.race['shapeshifter']){
            state.tabHash += (game.global.race.ss_genus ?? 'none').split('').reduce((a,b)=>{a=((a<<5)-a)+b.charCodeAt(0);return a&a},0);
        }

        if (update && state.tabHash !== oldHash){
            let mainVue = win.$('#mainColumn > div:first-child')[0].__vue__;
            mainVue.s.civTabs = 7;
            mainVue.s.tabLoad = false;
            mainVue.toggleTabLoad();
            mainVue.s.tabLoad = true;
            mainVue.toggleTabLoad();
            mainVue.s.civTabs = game.global.settings.civTabs;
            return true;
        } else {
            return false;
        }
    }

    function getMultiSegmentedTimeLeft(target) {
        let remainingSegments = target.gameMax - target.count;

        if (target instanceof Project) {
            remainingSegments = (100 - target.progress) / target.currentStep;
        }

        let longestResource = '',
            longestTimeLeft = 0;

        Object.keys(target.cost).forEach(resource => {
            const resourceCostTotal = (target.cost[resource] * remainingSegments);
            const resourceTimeLeftRaw = (resourceCostTotal - game.global.resource[resource].amount) / game.global.resource[resource].diff;

            if (resourceTimeLeftRaw > longestTimeLeft && resourceCostTotal > game.global.resource[resource].amount) {
                longestResource = resource;
                longestTimeLeft = resourceTimeLeftRaw;
            }
        });

        const timeLeft = longestTimeLeft === Infinity ? 'Never' : poly.timeFormat(longestTimeLeft);

        return {
            resource: longestResource,
            timeLeft
        };
    }

    function updateActiveTargetsUI(queuedTargets, type) {
        if (queuedTargets.length) {
            $(`#active_targets .target-type-box.${type}`).show();
        } else {
            $(`#active_targets .target-type-box.${type}`).hide();
            return;
        }

        $(`#active_targets ul.active_targets-list.${type}`).html(queuedTargets.map(target => {
            let targetName = target.name,
                targetTimeLeft = '',
                targetSegments = '',
                researchTimeLeft = 0,
                isArpaProject = type === 'arpa' || target instanceof Project,
                isMultiSegmented = target.is && target.is.multiSegmented;

            if (target.count && !isMultiSegmented) {
                targetName += ` #${target.count + 1}`;
            }

            if (target.instance && target.instance.time) {
                targetTimeLeft = `${target.instance.time}`;
            }

            const costs = target.cost;

            if (target instanceof Technology) {
                if ($.isEmptyObject(target.cost)) {
                    targetTimeLeft = 'Waiting on prerequisite';
                } else if (target.cost.Knowledge > game.global.resource.Knowledge.max) {
                    targetTimeLeft = 'Not enough Knowledge';
                }
            } else if (isArpaProject) {
                targetName += ` (${target.progress}%)`;

                const segmentedTimeLeft = getMultiSegmentedTimeLeft(target);
                targetTimeLeft = `${segmentedTimeLeft.timeLeft}</span> <span class="has-text-danger">(${segmentedTimeLeft.resource})</span>`;
            }

            const costsHTML = Object.keys(costs).map(resource => {
                let res = resources[resource],
                    className = 'has-text-success',
                    resourceTimeLeft = '';

                let resourceCost = costs[resource];

                if (isArpaProject) {
                    resourceCost = costs[resource] * ((100 - target.progress) / target.currentStep);
                } else if (isMultiSegmented) {
                    resourceCost = costs[resource] * (target.gameMax - target.count);
                }

                if (res.currentQuantity < resourceCost) {
                    className = 'has-text-danger';

                    if (res.maxQuantity >= resourceCost && res.income > 0) {
                        const timeLeftRaw = (resourceCost - res.currentQuantity) / res.income;

                        if (target instanceof Technology && timeLeftRaw > researchTimeLeft) {
                            researchTimeLeft = timeLeftRaw;
                        }

                        resourceTimeLeft = `${poly.timeFormat(timeLeftRaw)}`;
                        if (res === resources.Soul_Gem) {
                            resourceTimeLeft = `~${resourceTimeLeft}`;
                        }
                    } else if (isArpaProject && res.name === 'Knowledge' && res.income > 0) {
                        resourceTimeLeft = poly.timeFormat(res.currentQuantity / res.income);
                    } else {
                        targetTimeLeft = resourceTimeLeft = 'Never';
                    }
                }

                const progressBarWidth = (res.currentQuantity / resourceCost) * 100;

                const isReplicatingClassName = (game.global.race.replicator && game.global.race.replicator.res === resource) ? 'is-replicating' : '';

                return `
                    <li>
                        <div class='active_targets-resource-row'>
                            <div class='active_targets-resource-text'>
                                <span class='${className}'>${res.title}</span>
                            </div>
                            <div class="percentage-full-progress-bar-wrapper ${isReplicatingClassName}">
                                <div class="percentage-full-progress-bar" style="width: ${progressBarWidth}%;"></div>
                            </div>
                            <div class="active_targets-time-left">${resourceTimeLeft}</div>
                        </div>
                    </li>`;
            }).join('');

            if (isMultiSegmented) {
                targetSegments = `(${target.count} / ${target.gameMax})`;

                const segmentedTimeLeft = getMultiSegmentedTimeLeft(target);
                targetTimeLeft = `${segmentedTimeLeft.timeLeft} <span class="has-text-danger">(${segmentedTimeLeft.resource})</span>`;
            }

            if (target instanceof Technology && targetTimeLeft === '') {
                targetTimeLeft = poly.timeFormat(researchTimeLeft);
            }

            const targetNameDisplay = `<span class="active-target-title name">${targetName} </span><span class="active-target-title time">${targetTimeLeft} <span class="active-target-segments has-text-special">${targetSegments}</span></span>`;


            // for finding element in queue
            let queueid = '';
            if (type === 'buildings') {
                queueid = `${target._tab}-${target.id}`;
            } else if (type === 'arpa') {
                queueid = `${target._tab}${target.id}`;
            } else if (type === 'research' || type === 'triggers') {
                queueid = target.id;
            }

            return `
                    <li class="active-target-li">
                        ${targetNameDisplay} <span class="active-target-remove-x ${type}" data-queueid="${queueid}" data-type="${type}">＋</span>
                        <ul class="active_targets-sub-list">
                            ${costsHTML}
                        </ul>
                    </li>
                `;
        }));
    }

    function updateState() {
        if (game.global.race.species === "protoplasm") {
            state.goal = "Evolution";
        } else if (state.goal === "Evolution") {
            // Check what we got after evolution
            if (!checkEvolutionResult()) {
                return;
            }
            state.goal = "Standard";
            if (settingsRaw.triggers.length > 0) { // We've moved from evolution to standard play. There are technology descriptions that we couldn't update until now.
                updateTriggerSettingsContent();
            }
        } else if (game.global.stats.days === 1 && (game.global.race.slow || game.global.race.hyper || game.global.race.species === "junker")) {
            // Fallback check, in case if game reloaded page after evolution
            if (!checkEvolutionResult()) {
                return;
            }
        }

        // Reset required storage and prioritized resources
        for (let id in resources) {
            resources[id].maxCost = 0;
            resources[id].storageRequired = 1;
            resources[id].requestedQuantity = 0;
        }
        StorageManager.crateValue = poly.crateValue();
        StorageManager.containerValue = poly.containerValue();
        updatePriorityTargets();  // Set queuedTargets and triggerTargets
        ProjectManager.updateProjects(); // Set obj.cost, uses triggerTargets
        calculateRequiredStorages(); // Uses obj.cost
        prioritizeDemandedResources(); // Set res.requestedQuantity, uses queuedTargets and triggerTargets

        state.tooltips = {};
        state.moneyIncomes.shift();
        for (let i = state.moneyIncomes.length; i < 11; i++) {
            state.moneyIncomes.push(resources.Money.rateOfChange);
        }
        state.moneyMedian = [...state.moneyIncomes].sort((a,b) => a - b)[5];

        // This comes from the "const towerSize = (function(){" in portal.js in the game code
        let towerSize = 1000;
        if (game.global.hasOwnProperty('pillars')){
            for (let pillar in game.global.pillars) {
                if (game.global.pillars[pillar]){
                    towerSize -= 12;
                }
            }
        }

        state.astroSign = poly.astrologySign();

        buildings.GateEastTower.gameMax = towerSize;
        buildings.GateWestTower.gameMax = towerSize;

        // Space dock is special and has a modal window with more buildings!
        if (!buildings.GasSpaceDock.isOptionsCached()) {
            buildings.GasSpaceDock.cacheOptions();
        }

        if (settings.activeTargetsUI) {
            const queuedTargets = state.queuedTargetsAll;

            const triggersList = state.triggerTargets,
                buildingsList = [],
                researchList = [],
                arpaList = [];

            queuedTargets.forEach(target => {
                if (target instanceof Technology) {
                    researchList.push(target);
                } else if (target instanceof Project) {
                    arpaList.push(target);
                } else {
                    buildingsList.push(target);
                }
            });

            updateActiveTargetsUI(triggersList, 'triggers');
            updateActiveTargetsUI(buildingsList, 'buildings');
            updateActiveTargetsUI(researchList, 'research');
            updateActiveTargetsUI(arpaList, 'arpa');

            // remove from queue by clicking 
            $(".active-target-remove-x").click(function() {
                const queueId = $(this).data('queueid'),
                    type = $(this).data('type');

                const $queuedItem = $(".queued").filter((id, el) => {return el.id.indexOf(queueId) > -1});

                if (type === 'triggers') {
                    const clickedTrigger = TriggerManager.targetTriggers.find(trigger => trigger.actionId.includes(queueId));

                    if (clickedTrigger !== undefined && clickedTrigger !== null) {
                        clickedTrigger.complete = true;
                    }
                } else if ($queuedItem?.length) {
                    $queuedItem[0].click();
                }

                $("#active_targets-wrapper").css('height', 'auto');
            });
        } else {
            $(".active-target-remove-x").off('click');
        }
    }

    function verifyGameActions() {
        // Check that actions that exist in game also exist in our script
        verifyGameActionsExist(game.actions.city, buildings, false);
        verifyGameActionsExist(game.actions.space, buildings, true);
        verifyGameActionsExist(game.actions.interstellar, buildings, true);
        verifyGameActionsExist(game.actions.portal, buildings, true);
        verifyGameActionsExist(game.actions.galaxy, buildings, true);
    }

    function verifyGameActionsExist(gameObject, scriptObject, hasSubLevels) {
        let scriptKeys = Object.keys(scriptObject);
        for (let gameActionKey in gameObject) {
            if (!hasSubLevels) {
                verifyGameActionExists(scriptKeys, scriptObject, gameActionKey, gameObject);
            } else {
                // This object has sub levels - iterate through them
                let gameSubObject = gameObject[gameActionKey];
                for (let gameSubActionKey in gameSubObject) {
                    verifyGameActionExists(scriptKeys, scriptObject, gameSubActionKey, gameSubObject);
                }
            }
        }
    }

    function verifyGameActionExists(scriptKeys, scriptObject, gameActionKey, gameObject) {
        // We know that we don't have the info objects defined in our script
        // gift is a special santa gift. Leave it to the player.
        // bonfire and firework belongs to seasonal events
        // replicator is a fake building
        if (["info", "gift", "bonfire", "firework", "replicator"].includes(gameActionKey)) {
            return;
        }

        let scriptActionFound = false;

        for (let i = 0; i < scriptKeys.length; i++) {
            const scriptAction = scriptObject[scriptKeys[i]];
            if (scriptAction.id === gameActionKey) {
                scriptActionFound = true;
                break;
            }
        }

        if (!scriptActionFound) {
            console.log("Game action key not found in script: " + gameActionKey + " (" + gameObject[gameActionKey].id + ")");
            console.log(gameObject[gameActionKey]);
        }
    }

    function initialiseScript() {
        // Init objects and lookup tables
        for (let [key, action] of Object.entries(game.actions.tech)) {
            techIds[action.id] = new Technology(key);
        }
        for (let building of Object.values(buildings)){
            buildingIds[building._vueBinding] = building;
            // Don't force building Jump Ship and Pit Assault, they're prety expensive at the moment when unlocked.
            if (building.isMission() && building !== buildings.BlackholeJumpShip && building !== buildings.PitAssaultForge) {
                state.missionBuildingList.push(building);
            }
        }
        for (let project of Object.values(projects)){
            arpaIds[project._vueBinding] = project;
        }
        for (let job of Object.values(jobs)){
            jobIds[job._originalId] = job;
        }
        for (let job of Object.values(crafter)){
            jobIds[job._originalId] = job;
        }

        updateStandAloneSettings();
        updateStateFromSettings();
        updateSettingsFromState();

        TriggerManager.priorityList.forEach(trigger => {
            trigger.complete = false;
        });

        // If debug logging is enabled then verify the game actions code is both correct and in sync with our script code
        if (checkActions) {
            verifyGameActions();
        }

        // Normal popups
        new MutationObserver(tooltipObserverCallback).observe(document.getElementById("main"), {childList: true});

        // Modals; check script callbacks and add Space Dock tooltips
        new MutationObserver(bodyMutations =>  bodyMutations.forEach(bodyMutation => bodyMutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("modal")) {
                if (WindowManager.openedByScript) {
                    node.style.display = "none"; // Hide splash
                    new MutationObserver(WindowManager.checkCallbacks).observe(document.getElementById("modalBox"), {childList: true});
                } else {
                    new MutationObserver(tooltipObserverCallback).observe(node, {childList: true});
                }
            }
        }))).observe(document.querySelector("body"), {childList: true});

        // Log filtering
        buildFilterRegExp();
        new MutationObserver(filterLog).observe(document.getElementById("msgQueueLog"), {childList: true});
    }

    function buildFilterRegExp() {
        let regexps = [];
        let validIds = [];
        let strings = settingsRaw.logFilter.split(/[^0-9a-z_%]/g).filter(Boolean);
        for (let i = 0; i < strings.length; i++) {
            let [id, ...params] = strings[i].split("%");
            params = params.map(game.loc);
            // Loot message built from multiple strings without tokens, let's fake one for regexp below
            let message = game.loc(id, params.length ? params : undefined) + (id === "civics_garrison_gained" ? "%0" : "");
            if (message === id) {
                continue;
            }
            regexps.push(message.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%\d/g, ".*"));
            validIds.push(strings[i]);
        }
        if (regexps.length > 0) {
            state.filterRegExp = new RegExp("^(" + regexps.join("|") + ")$");
            settingsRaw.logFilter = validIds.join(", ");
        } else {
            state.filterRegExp = null;
            settingsRaw.logFilter = "";
        }
    }

    function filterLog(mutations) {
        if (!settings.masterScriptToggle || !state.filterRegExp) {
            return;
        }
        mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
            if (state.filterRegExp.test(node.innerText)) {
                node.remove();
            }
        }));
    }

    function getTooltipInfo(obj) {
        let notes = [];
        if (obj === buildings.NeutronCitadel) {
            let diff = getCitadelConsumption(obj.stateOnCount + 1) - getCitadelConsumption(obj.stateOnCount);
            notes.push(`Next level will increase total consumption by ${getNiceNumber(diff)} MW`);
        }
        if (obj === buildings.SpireMechBay && MechManager.initLab()) {
            notes.push(`Current team potential: ${getNiceNumber(MechManager.mechsPotential)}`);
            let supplyCollected = MechManager.activeMechs
              .filter(mech => mech.size === 'collector')
              .reduce((sum, mech) => sum + (mech.power * MechManager.collectorValue), 0);
            if (supplyCollected > 0) {
                notes.push(`Supplies collected: ${getNiceNumber(supplyCollected)} /s`);
            }
        }

        if ((obj instanceof Technology || (!settings.autoARPA && obj._tab === "arpa") || (!settings.autoBuild && obj._tab !== "arpa")) && !state.queuedTargetsAll.includes(obj) && !state.triggerTargets.includes(obj)) {
            let conflict = getCostConflict(obj);
            if (conflict) {
                notes.push(`Conflicts with ${conflict.actionList.map(action => {return `<span class="has-text-info">${action}</span>`;}).join(', ')} for ${conflict.resList.map(res => {return `<span class="has-text-info">${res}</span>`;}).join(', ')} (${conflict.obj.cause})`);
            }
        }

        if (obj instanceof Technology) {
            if (state.queuedTargetsAll.includes(obj)) {
                notes.push("Queued research, processing...");
            } else if (state.triggerTargets.includes(obj)) {
                notes.push("Active trigger, processing...");
            } else {
                let conflict = getTechConflict(obj);
                if (conflict) {
                    notes.push(conflict);
                }
            }
        }

        if (obj === buildings.GorddonFreighter && haveTech('banking', 13)) {
            let count = obj.stateOnCount;
            let total = (((1 + ((count + 1) * 0.03)) / (1 + ((count) * 0.03))) - 1) * 100;
            let crew = total / 3;
            notes.push(`Next level will increase ${buildings.AlphaExchange.title} storage by +${getNiceNumber(total)}% (+${getNiceNumber(crew)}% per crew)`);
        }
        if (obj === buildings.Alien1SuperFreighter && haveTech('banking', 13)) {
            let count = obj.stateOnCount;
            let total = (((1 + ((count + 1) * 0.08)) / (1 + ((count) * 0.08))) - 1) * 100;
            let crew = total / 5;
            notes.push(`Next level will increase ${buildings.AlphaExchange.title} storage by +${getNiceNumber(total)}% (+${getNiceNumber(crew)}% per crew)`);
        }
        if (obj === buildings.Hospital
            || (obj === buildings.BootCamp && game.global.race['artifical'])
            || (obj === buildings.EnceladusBase && game.global.race['orbit_decayed'])) {
            notes.push(`~${getNiceNumber(getHealingRate())} soldiers healed per day`);
        }
        if (obj === buildings.Hospital) {
            let growth = 1 / (getGrowthRate() * 4); // Fast loop, 4 times per second
            notes.push(`~${getNiceNumber(growth)} seconds to increase population`);
        }
        if (obj === buildings.PortalCarport && jobs.HellSurveyor.count > 0) {
            let influx = 5 * (1 + (buildings.BadlandsAttractor.stateOnCount * 0.22));
            let demons = (influx * 10 + influx * 50) / 2;
            let divisor = getGovernor() === 'sports' ? 1100 : 1000;
            divisor *= traitVal('blurry', 0, '+');
            divisor *= traitVal('instinct', 0, '+');
            divisor += haveTech('infernite', 5) ? 250 : 0;
            let danger = demons / divisor;
            let risk = 10 - Math.min(10, jobs.HellSurveyor.count) / 2;
            let rate = (danger / 2 * Math.min(1, danger / risk));
            let wreck = 1 / (rate / 5); // Long loop, once per 5 seconds
            notes.push(`Up to ~${getNiceNumber(wreck)} seconds to break car (with full supression)`);
        }
        if (obj === buildings.PortalRepairDroid) {
            let wallRepair = Math.round(200 * (0.95 ** obj.stateOnCount)) / 4;
            let carRepair = Math.round(180 * (0.92 ** obj.stateOnCount)) / 4;
            notes.push(`${getNiceNumber(wallRepair)} seconds to repair 1% of wall`);
            notes.push(`${getNiceNumber(carRepair)} seconds to repair car`);
        }
        if (obj === buildings.BadlandsAttractor) {
            let influx = 5 * (1 + (obj.stateOnCount * 0.22));
            let gem_chance = game.global.stats.achieve.technophobe?.l >= 5 ? 9000 : 10000;
            if (game.global.race.universe === 'evil' && resources.Dark.currentQuantity > 1) {
                let de = resources.Dark.currentQuantity * (1 + resources.Harmony.currentQuantity * 0.01);
                gem_chance -= Math.round(Math.log2(de) * 2);
            }
            gem_chance = Math.round(gem_chance * (0.948 ** obj.stateOnCount));
            gem_chance = Math.round(gem_chance * traitVal('ghostly', 2, '-'));
            gem_chance = Math.max(12, gem_chance);
            let drop = (1 / gem_chance) * 100;
            notes.push(`~${getNiceNumber(drop)}% chance to find ${resources.Soul_Gem.title}`);
            notes.push(`Up to ~${getNiceNumber(influx*10)}-${getNiceNumber(influx*50)} demons spawned per day`);
        }
        if (obj === buildings.Smokehouse) {
            let spoilage = 50 * (0.9 ** obj.count);
            notes.push(`${getNiceNumber(spoilage)}% of stored ${resources.Food.title} spoiled per second`);
        }
        if (obj === buildings.LakeCoolingTower) {
            let coolers = buildings.LakeCoolingTower.stateOnCount;
            let current = 500 * (0.92 ** coolers);
            let next = 500 * (0.92 ** (coolers+1));
            let diff = ((current - next) * buildings.LakeHarbour.stateOnCount) * (game.global.race['emfield'] ? 1.5 : 1);
            notes.push(`Next level will decrease total consumption by ${getNiceNumber(diff)} MW`);
        }
        if (obj === buildings.DwarfShipyard) {
            if (settings.autoFleet && FleetManagerOuter.nextShipMsg) {
                notes.push(FleetManagerOuter.nextShipMsg);
            }
        }

        if (obj.extraDescription) {
            notes.push(obj.extraDescription);
        }
        return notes.join("<br>");
    }

    function tooltipObserverCallback(mutations) {
        if (!settings.masterScriptToggle) {
            return;
        }
        mutations.forEach(mutation => mutation.addedNodes.forEach(node => {
            if (node.id === "popper") {
                let popperObserver = new MutationObserver((popperMutations) => {
                    // Add tooltips once again when popper cleared
                    if (!node.querySelector(".script-tooltip")) {
                        popperObserver.disconnect();
                        addTooltip(node);
                        popperObserver.observe(node, {childList: true});
                    }
                })
                addTooltip(node);
                popperObserver.observe(node, {childList: true});
            }
        }));
    }

    const infusionStep = {"blood-lust": 15, "blood-illuminate": 12, "blood-greed": 16, "blood-hoarder": 14, "blood-artisan": 8, "blood-attract": 4, "blood-wrath": 2};
    function addTooltip(node) {
        $(node).append(`<span class="script-tooltip" hidden></span>`);
        let dataId = node.dataset.id;
        // Tooltips for things with no script objects
        if (dataId === 'powerStatus') {
            $(node).append(`<p class="modal_bd"><span>Disabled</span><span class="has-text-danger">${getNiceNumber(resources.Power.maxQuantity)}</span></p>`);
            return;
        } else if (infusionStep[dataId]) {
            $(node).find('.costList .res-Blood_Stone').append(` (+${infusionStep[dataId]})`);
            return;
        } else if (state.tooltips[dataId]) {
            $(node).append(`<div style="border-top: solid .0625rem #999">${state.tooltips[dataId]}</div>`);
            return;
        }

        let match = null;
        let obj = null;
        if (match = dataId.match(/^popArpa([a-z_-]+)\d*$/)) { // "popArpa[id-with-no-tab][quantity]" for projects
            obj = arpaIds["arpa" + match[1]];
        } else if (match = dataId.match(/^q([A-Za-z_-]+)\d*$/)) { // "q[id][order]" for buildings in queue
            obj = buildingIds[match[1]] || arpaIds[match[1]];
        } else { // "[id]" for buildings and researches
            obj = buildingIds[dataId] || techIds[dataId];
        }
        if (!obj || (obj instanceof Technology && obj.isResearched())) {
            return;
        }

        // Flair, added before other descriptions
        if (obj === buildings.BlackholeStellarEngine && game.global.race.universe !== "magic" && buildings.BlackholeMassEjector.count > 0 && game.global.interstellar.stellar_engine.exotic < 0.025) {
            let massPerSec = (resources.Elerium.atomicMass * game.global.interstellar.mass_ejector.Elerium + resources.Infernite.atomicMass * game.global.interstellar.mass_ejector.Infernite) || -1;
            let missingExotics = (0.025 - game.global.interstellar.stellar_engine.exotic) * 1e10;
            $(node).append(`<div id="popTimer" class="flair has-text-advanced">Contaminated in [${poly.timeFormat(missingExotics / massPerSec)}]</div>`);
        }
        if (obj === buildings.TauRedJeff && buildings.TauRedWomlingLab.count > 0) {
            let expo = game.global.stats.achieve.overlord?.l >= 5 ? 4.9 : 5;
            expo -= game.global.race['lone_survivor'] ? 0.1 : 0;
            let nextTech = ((game.global.tech.womling_tech + 2) ** expo);
            let curTech = game.global.tauceti.womling_lab.tech;
            let completion = Math.floor((curTech / nextTech) * 100);
            $(node).find('div:eq(1)>div:eq(5)').append(` (${completion}%)`);
            let rate = (game.global.tauceti.womling_lab.scientist / 2) * Math.min(1, game.global.tauceti.womling_lab.scientist * 0.1);
            let eta = rate > 0 ? Math.ceil((nextTech - curTech) / rate) : -1;
            $(node).append(`<div id="popTimer" class="flair has-text-advanced">Next Tech Level in ~[${poly.timeFormat(eta)}]</div>`);
        }

        let description = getTooltipInfo(obj);
        if (description) {
            $(node).append(`<div style="border-top: solid .0625rem #999">${description}</div>`);
        }
    }

    // We need to know the difference between returning null/undefined (possible bug in user eval, should warn) vs just returning nothing.
    // This symbol is a specific placeholder value we return when none of the override conditions were met.
    // The calling function should check against this and use its default behavior if returned.
    const OVERRIDE_NO_VALUE = Symbol("evaluateOverride returned nothing");
    function evaluateOverride(override, displayName, expectedType) {
        let xorList = [];
        for (let i = 0; i < override.length; i++) {
            let check = override[i];

            try {
                if (!checkTypes[check.type1]) {
                    throw `${check.type1} variable not found`;
                }
                if (!checkTypes[check.type2]) {
                    throw `${check.type2} variable not found`;
                }
                if (!checkCompare[check.cmp]) {
                    throw `${checkCompare[check.cmp]} comparator not found`;
                }
                let var1 = checkTypes[check.type1].fn(check.arg1);
                let var2 = checkTypes[check.type2].fn(check.arg2);
                if (!checkCompare[check.cmp](var1, var2)) {
                    continue;
                }
                let ret = checkCustom[check.cmp] ? var2 : check.ret;

                if (expectedType === "object") {
                    xorList.push(ret);
                } else if (expectedType === typeof ret) {
                    return ret;
                } else {
                    throw `Expected type: ${expectedType}; Override type: ${typeof ret}`;
                }
            } catch (error) {
                let msg = `Condition ${i + 1} for setting ${displayName} invalid! Fix or remove it. (${error})`;
                if (!WindowManager.isOpen() && !Object.values(game.global.lastMsg.all).find(log => log.m === msg)) { // Don't spam with errors
                    GameLog.logDanger("special", msg, ['events', 'major_events']);
                }
                continue; // Some argument not valid, skip condition
            }
        }
        return (expectedType === "object" && xorList.length) ? xorList : OVERRIDE_NO_VALUE;
    }

    function updateOverrides() {
        let xorLists = {};
        let overrides = {};
        for (let key in settingsRaw.overrides) {
            let result = evaluateOverride(settingsRaw.overrides[key], key, typeof settingsRaw[key]);

            if(result === OVERRIDE_NO_VALUE) {
                // Didn't return anything - keep using default value
            }
            else if (typeof settingsRaw[key] !== "object") {
                // Override single value
                overrides[key] = result;
            }
            else {
                // Xor lists
                xorLists[key] = result;
            }
        }

        if (haveTask("bal_storage")) {
            overrides["autoStorage"] = false;
        }
        if (haveTask("trash")) {
            overrides["autoEject"] = false;
        }
        if (haveTask("tax")) {
            overrides["autoTax"] = false;
        }
        overrides["tickRate"] = Math.min(240, Math.max(1, Math.round((overrides["tickRate"] ?? settingsRaw["tickRate"])*2))/2);

        // Apply overrides
        Object.assign(settings, settingsRaw, overrides);

        // Xor lists
        for (let key in xorLists) {
            settings[key] = settingsRaw[key].slice();
            for (let item of xorLists[key]) {
                let index = settings[key].indexOf(item);
                if (index > -1) {
                    settings[key].splice(index, 1);
                } else {
                    settings[key].push(item);
                }
            }
        }

        let currentNode = $(`#script_override_true_value:visible`);
        if (currentNode.length !== 0) {
            changeDisplayInputNode(currentNode);
        }
    }

    function automateLab() {
        let createCustom = document.querySelector("#celestialLab .create button");
        if (createCustom) {
            updateOverrides(); // Game doesn't tick in lab. Update settings here.
            if (settings.masterScriptToggle && settings.autoPrestige && (settings.prestigeType === "ascension" || settings.prestigeType === "terraform")) {
                state.goal = "GameOverMan";
                createCustom.click();
                return;
            }
        }
    }

    function automate() {
        if (state.goal === "GameOverMan" || state.forcedUpdate || !state.gameTicked) {
            return;
        }
        state.gameTicked = false;
        if (state.scriptTick < Number.MAX_SAFE_INTEGER) {
            state.scriptTick++;
        } else {
            state.scriptTick = 1;
        }
        if (state.scriptTick % (game.global.settings.at ? settings.tickRate * 2 : settings.tickRate) !== 0) {
            return;
        }

        updateScriptData(); // Sync exposed data with script variables
        updateOverrides();  // Apply settings overrides as soon as possible
        finalizeScriptData(); // Second part of updating data, applying settings

        // Redraw tabs once they unlocked
        if (updateTabs(true)) {
            return;
        }

        // TODO: Properly sepparate updateState between updateScriptData and finalizeScriptData
        updateState();
        updateUI();
        KeyManager.reset();

        // The user has turned off the master toggle. Stop taking any actions on behalf of the player.
        // We've still updated the UI etc. above; just not performing any actions.
        if (!settings.masterScriptToggle) { return; }

        if (state.goal === "Evolution") {
            if (settings.autoEvolution) {
                autoEvolution();
            }
            return;
        }

        if (settings.buildingAlwaysClick || settings.autoBuild){
            autoGatherResources();
        }
        if (settings.autoMarket) {
            autoMarket(); // Invalidates values of resources, changes are random and can't be predicted, but we won't need values anywhere else
        }
        if (settings.autoHell) {
            autoHell();
        }
        if (settings.autoGalaxyMarket) {
            autoGalaxyMarket();
        }
        if (settings.autoFactory) {
            autoFactory();
        }
        if (settings.autoMiningDroid) {
            autoMiningDroid();
        }
        if (settings.autoGraphenePlant) {
            autoGraphenePlant();
        }
        if (settings.autoAlchemy) {
            autoAlchemy();
        }
        if (settings.autoPylon) {
            autoPylon();
        }
        if (settings.autoQuarry) {
            autoQuarry();
        }
        if (settings.autoMine) {
            autoMine();
        }
        if (settings.autoExtractor) {
            autoExtractor();
        }
        if (settings.autoSmelter) {
            autoSmelter();
        }
        if (settings.autoStorage) {
            // Called before autoJobs, autoFleet and autoPower - so they wont mess with quantum
            autoStorage();
        }
        if (settings.autoReplicator) {
            autoReplicator();
        }
        if (!settings.autoTrigger || !autoTrigger()) {
            // Only go to autoResearch and autoBuild if triggers not building anything at this very moment, to ensure they won't steal reasources from triggers
            if (settings.autoResearch) {
                autoResearch(); // Called before autoBuild and autoGenetics - knowledge goes to techs first
            }
            if (settings.autoBuild || settings.autoARPA) {
                autoBuild(); // Called after autoStorage to compensate fluctuations of quantum(caused by previous tick's adjustments) levels before weightings
            }
        }
        if (settings.autoJobs) {
            autoJobs();
        } else if (settings.autoCraftsmen) {
            autoJobs(true);
        }
        if (settings.autoFleet) {
            if (game.global.race['truepath']) {
                autoFleetOuter();
            } else {
                autoFleet(); // Need to know Mine Layers stateOnCount, called before autoPower while it's still valid
            }
        }
        if (settings.autoMech) {
            autoMech(); // Called after autoBuild, to prevent stealing supplies from mechs
        }
        if (settings.autoGenetics) {
            autoGenetics(); // Called after autoBuild and autoResearch to prevent stealing knowledge from them
        }
        if (settings.autoMinorTrait) {
            autoMinorTrait(); // Called after auto assemble to utilize new genes right asap
        }
        if (settings.autoCraft) {
            autoCraft(); // Invalidates quantities of craftables, missing exposed craftingRatio to calculate craft result on script side
        }
        if (settings.autoFight) {
            autoMerc();
            autoSpy(); // Can unoccupy foreign power in rare occasions, without caching back new status, but such desync should not cause any harm
            autoBattle(); // Invalidates garrison, and adds unaccounted amount of resources after attack
        }
        if (settings.autoTax) {
            autoTax();
        }
        if (settings.autoGovernment) {
            autoGovernment();
        }
        if (settings.autoNanite) {
            autoConsume(NaniteManager); // Purge remaining rateOfChange, should be called when it won't be needed anymore
        }
        if (settings.autoSupply) {
            autoConsume(SupplyManager);
        }
        if (settings.autoEject) {
            autoConsume(EjectManager);
        }
        if (settings.autoPower) { // Called after purging of rateOfChange, to know useless resources
            autoPower();
        }
        if (isPrestigeAllowed()) {
            autoPrestige(); // Called after autoBattle to not launch attacks right before reset, killing soldiers
        }
        if (settings.autoMinorTrait) {
            autoShapeshift(); // Shifting genus can remove techs, buildings, resources, etc. Leaving broken preloaded buttons behind. This thing need to be at the very end, to prevent clicking anything before redrawing tabs
            autoPsychic();
        }
        if (settings.autoMutateTraits) {
            autoMutateTrait();
        }

        KeyManager.finish();
        state.soulGemLast = resources.Soul_Gem.currentQuantity;
    }

    function mainAutoEvolveScript() {
        // This is a hack to check that the entire page has actually loaded. The queueColumn is one of the last bits of the DOM
        // so if it is there then we are good to go. Otherwise, wait a little longer for the page to load.
        if (document.getElementById("queueColumn") === null) {
            setTimeout(mainAutoEvolveScript, 100);
            return;
        }

        // We'll need real window to access vue objects
        if (typeof unsafeWindow !== 'undefined') {
            win = unsafeWindow;
        } else {
            win = window;
            // Chrome overrides original JQuery with one required by script, we need to restore it to get $._data with events handlers
            // I'd get rid of this JQuery copy altogether, that's a right way to do it. No duplicate - no conflicts... But that breaks that damn FF.
            if (!win.$._data(win.document).events?.['keydown']) {
                $.noConflict();
            }
        }
        game = win.evolve;

        // Check if game exposing anything
        if (!game) {
            if (state.warnDebug) {
                state.warnDebug = false;
                alert("You need to enable Debug Mode in settings for script to work");
            }
            setTimeout(mainAutoEvolveScript, 100);
            return;
        }

        // Wait until exposed data fully initialized ('p' in fastLoop, 'c' in midLoop)
        if (!game.global?.race || !game.breakdown.p.consume) {
            setTimeout(mainAutoEvolveScript, 100);
            return;
        }

        // Now we can check setting. Ensure game tabs are preloaded
        if (!game.global.settings.tabLoad) {
            if (state.warnPreload) {
                state.warnPreload = false;
                alert("You need to enable Preload Tab Content in settings for script to work");
            }
            setTimeout(mainAutoEvolveScript, 100);
            return;
        }

        // Make sure we have jQuery UI even if script was injected without *monkey
        if (!$.ui) {
            let el = document.createElement("script");
            el.src = "https://code.jquery.com/ui/1.12.1/jquery-ui.min.js";
            el.onload = mainAutoEvolveScript;
            el.onerror = () => alert("Can't load jQuery UI. Check browser console for details.");
            document.body.appendChild(el);
            return;
        }

        // Wrappers for firefox, with code to bypass script sandbox. If we're not on firefox - don't use it, call real functions instead
        if (typeof unsafeWindow !== "object" || typeof cloneInto !== "function") {
            poly.adjustCosts = game.adjustCosts;
            poly.loc = game.loc;
            poly.messageQueue = game.messageQueue;
            poly.shipCosts = game.shipCosts;
        }

        addScriptStyle();
        KeyManager.init();
        initialiseState();
        initialiseRaces();
        initialiseScript();
        updateOverrides();

        // Hook to game loop, to allow script run at full speed in unfocused tab
        const setCallback = (fn) => (typeof unsafeWindow !== "object" || typeof exportFunction !== "function") ? fn : exportFunction(fn, unsafeWindow);
        let craftCost = game.craftCost;
        Object.defineProperty(game, 'craftCost', {
            get: setCallback(() => craftCost),
            set: setCallback(v => {
                craftCost = v;
                state.gameTicked = true;
                if (settings.tickSchedule) {
                    setTimeout(automate);
                } else {
                    automate();
                }
            })
        });
        // Game disables workers in lab ui, we need to check that outside of debug hook
        setInterval(automateLab, 2500);
    }

    function updateDebugData() {
        state.forcedUpdate = true;
        game.updateDebugData();
        state.forcedUpdate = false;
    }

    function addScriptStyle() {
        // background = @html-background, alt = @market-item-background, hover = (alt - 0x111111), border = @primary-border, primary = @primary-color
        let cssData = {
            dark: {background: "#282f2f", alt: "#0f1414", hover: "#010303", border: "#ccc", primary: "#fff", hasTextWarning: '#ffdd57'},
            light: {background: "#fff", alt: "#dddddd", hover: "#ccc", border: "#000", primary: "#000", hasTextWarning: '#7a6304'},
            night: {background: "#282f2f", alt: "#1b1b1b", hover: "#0a0a0a", border: "#ccc", primary: "#fff", hasTextWarning: '#ffdd57'},
            darkNight: {background: "#282f2f", alt: "#1b1b1b", hover: "#0a0a0a", border: "#ccc", primary: "#b8b8b8", hasTextWarning: '#ffcc00'},
            redgreen: {background: "#282f2f", alt: "#1b1b1b", hover: "#0a0a0a", border: "#ccc", primary: "#fff", hasTextWarning: '#ffdd57'},
            gruvboxLight: {background: "#fbf1c7", alt: "#f9f5d7", hover: "#e8e4c6", border: "#3c3836", primary: "#3c3836", hasTextWarning: '#b57614'},
            gruvboxDark: {background: "#282828", alt: "#1d2021", hover: "#0c0f10", border: "#3c3836", primary: "#ebdbb2", hasTextWarning: '#fabd2f'},
            orangeSoda: {background: "#131516", alt: "#292929", hover: "#181818", border: "#313638", primary: "#EBDBB2", hasTextWarning: '#F06543'},
            dracula: {background: "#282a36", alt: "#1d2021", hover: "#C0F10", border: "#44475a", primary: "#f8f8f2", hasTextWarning: '#f1fa8c'},
        };
        let styles = "";
        // Colors for different themes
        for (let [theme, color] of Object.entries(cssData)) {
            styles += `
                html.${theme} .script-modal-content {
                    background-color: ${color.background};
                }

                html.${theme} .script-modal-header {
                    border-color: ${color.border};
                }

                /*
                html.${theme} .script-modal-body .button {
                    background-color: ${color.alt};
                }*/

                html.${theme} .script-modal-body table td,
                html.${theme} .script-modal-body table th {
                    border-color: ${color.border};
                }

                html.${theme} .script-collapsible {
                    background-color: ${color.alt};
                }

                html.${theme} .script-collapsible:after {
                    color: ${color.primary};
                }

                html.${theme} .script-contentactive,
                html.${theme} .script-collapsible:hover {
                    background-color: ${color.hover};
                }

                html.${theme} .percentage-full-progress-bar-wrapper {
                    background-color: ${color.hasTextWarning}15;
                }
                html.${theme} .percentage-full-progress-bar {
                    background-color: ${color.hasTextWarning}75;
                }

                html.${theme} .percentage-full-progress-bar-wrapper.is-replicating {
                    background-image: linear-gradient(135deg,${color.hasTextWarning}30 25%,transparent 25%,transparent 50%,${color.hasTextWarning}30 50%,${color.hasTextWarning}30 75%,transparent 75%,transparent);
                }

                html.${theme} #active_targets .target-type-box {
                    background-color: ${color.alt}75;
                }`;
        };
        styles += `
            .script-lastcolumn:after { float: right; content: "\\21c5"; }
            .script-refresh:after { float: right; content: "\\21ba"; cursor: pointer; }
            .script-draggable { cursor: move; cursor: grab; }
            .script-draggable:active { cursor: grabbing !important; }
            .ui-sortable-helper { display: table; cursor: grabbing !important; }

            .script-collapsible {
                color: white;
                cursor: pointer;
                padding: 18px;
                width: 100%;
                border: none;
                text-align: left;
                outline: none;
                font-size: 15px;
            }

            .script-collapsible:after {
                content: '\\002B';
                color: white;
                font-weight: bold;
                float: right;
                margin-left: 5px;
            }

            .script-contentactive:after {
                content: "\\2212";
            }

            .script-content {
                padding: 0 18px;
                display: none;
                //max-height: 0;
                overflow: hidden;
                //transition: max-height 0.2s ease-out;
            }

            .script-searchsettings {
                width: 100%;
                margin-top: 20px;
                margin-bottom: 10px;
            }

            /* Open script options button */
            .s-options-button {
                padding-right: 2px;
                cursor: pointer;
            }

            /* The Modal (background) */
            .script-modal {
              display: none; /* Hidden by default */
              position: fixed; /* Stay in place */
              z-index: 100; /* Sit on top */
              left: 0;
              top: 0;
              width: 100%; /* Full width */
              height: 100%; /* Full height */
              background-color: rgb(0,0,0); /* Fallback color */
              background-color: rgba(10,10,10,.86); /* Blackish w/ opacity */
              overflow-y: auto; /* Allow scrollbar */
            }

            /* Modal Content/Box */
            .script-modal-content {
                position: relative;
                margin: auto;
                margin-top: 50px;
                margin-bottom: 50px;
                padding: 0px;
                width: 900px;
                border-radius: .5rem;
                text-align: center;
            }

            .script-modal-content.override-modal {
                width: 70%;
                min-width: 900px;
            }

            /* The Close Button */
            .script-modal-close {
              float: right;
              font-size: 28px;
              margin-top: 20px;
              margin-right: 20px;
            }

            .script-modal-close:hover,
            .script-modal-close:focus {
              cursor: pointer;
            }

            /* Modal Header */
            .script-modal-header {
              padding: 4px 16px;
              margin-bottom: .5rem;
              border-bottom: #ccc solid .0625rem;
              text-align: center;
            }

            /* Modal Body */
            .script-modal-body {
                padding: 2px 16px;
                text-align: center;
                overflow: auto;
            }

            /* Autocomplete styles */
            .ui-autocomplete {
                background-color: #000;
                position: absolute;
                top: 0;
                left: 0;
                cursor: default;
                z-index: 10000 !important;
            }

            .ui-helper-hidden-accessible {
                border: 0;
                clip: rect(0 0 0 0);
                height: 1px;
                margin: -1px;
                overflow: hidden;
                padding: 0;
                position: absolute;
                width: 1px;
            }

            .selectable span {
                -moz-user-select: text !important;
                -khtml-user-select: text !important;
                -webkit-user-select: text !important;
                -ms-user-select: text !important;
                user-select: text !important;
            }

            .ea-craft-toggle {
                max-width:75px;
                margin-top:4px;
                float:right;
                left:50%;
            }

            /* Reduce message log clutterness */
            .main #msgQueueFilters span:not(:last-child) {
                !important; margin-right: 0.25rem;
            }

            /* Fixes for game styles */
            .main .resources .resource :first-child { white-space: nowrap; }
            #popTimer { margin-bottom: 0.1rem }
            .barracks { white-space: nowrap; }
            .area { width: calc(100% / 6) !important; max-width: 8rem; }
            .offer-item { width: 15% !important; max-width: 7.5rem; }
            .tradeTotal { margin-left: 11.5rem !important; }

            /* Styles for queued targets UI */
            #active_targets-wrapper {
                padding: 1rem;
                max-height: 50vh;
            }

            #sideQueue #active_targets-wrapper {
                max-height: 50vh;
            }

            #active_targets {
                font-size: 0.9em;
                max-width: 500px;
            }

            #active_targets .target-type-box {
                background-color: #1d2021;
                margin: 10px 0;
                padding: 0.5rem 1rem;
            }

            #active_targets ul {
                list-style-type: none;
                padding-top: 5px;
            }

            .active_targets-list > li {
                margin-top: 10px;
                width: 100%;
            }

            .active-target-title {
                display: inline-block;
            }
            .active-target-title.name {
                width: 40%;
            }
            .active-target-title.time {
                width: 40%;
            }
            .active-target-segments {
                white-space: nowrap;
            }

            #active_targets .active_targets-sub-list {
                list-style-type: none;
            }

            #active_targets .active_targets-sub-list li {
                width: 100%;
                padding: 0;
            }

            #active_targets > ul > li:not(:first-child) {
              margin-top: 10px;
            }

            #active_targets .active_targets-resource-text {
                display: flex;
                width: 40%;
            }

            #active_targets .active_targets-resource-text span {
                margin-left: 10px;
            }

            #active_targets .active_targets-resource-row {
                display: flex;
            }

            #active_targets .active_targets-resource-row .percentage-full-progress-bar-wrapper {
                display: flex;
                margin: 5px 0 0 0;
                width: 35%;
                height: 9px;
                overflow: hidden;
            }

            .percentage-full-progress-bar-wrapper.is-replicating {
                background-image: linear-gradient(135deg,rgba(255,255,255,.95) 25%,transparent 25%,transparent 50%,rgba(255,255,255,.95) 50%,rgba(255,255,255,.95) 75%,transparent 75%,transparent);
                background-size: 20px 20px;
                animation: progress-bar-stripes 2s linear reverse infinite;
            }

            @keyframes progress-bar-stripes {
              0% {
                background-position: 40px 0;
              }
              100% {
                background-position: 0 0;
              }
            }

            #active_targets .active_targets-time-left {
                width: auto;
                text-align: left;
                font-size: 0.8rem;
                margin-left: 10px;
            }

            .active-target-remove-x {
                margin-left: 10px;
                opacity: 0.5;
                cursor: pointer;
                float: right;
                transform: rotate(45deg);
                font-size: 1.1rem;
                line-height: 1rem;
            }

            .active-target-remove-x:hover {
                opacity: 1;
                font-size: 1.2rem;
            }
        `;

        // Create style document
        var css = document.createElement('style');
        css.type = 'text/css';
        css.appendChild(document.createTextNode(styles));

        // Append style to html head
        document.getElementsByTagName("head")[0].appendChild(css);
    }

    function removeScriptSettings() {
        $("#script_settings").remove();
    }

    function buildScriptSettings() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let scriptContentNode = $('#script_settings');
        if (scriptContentNode.length !== 0) {
            return;
        }

        scriptContentNode = $('<div id="script_settings" style="margin-top: 30px;"></div>');
        $(".settings").append(scriptContentNode);

        buildImportExport();
        buildPrestigeSettings(scriptContentNode, "");
        buildGeneralSettings();
        buildGovernmentSettings(scriptContentNode, "");
        buildEvolutionSettings();
        buildPlanetSettings();
        buildTraitSettings();
        buildTriggerSettings();
        buildAdvTriggerSettings();
        buildResearchSettings();
        buildWarSettings(scriptContentNode, "");
        buildHellSettings(scriptContentNode, "");
        buildMechSettings();
        buildFleetSettings(scriptContentNode, "");
        buildEjectorSettings();
        buildMarketSettings();
        buildStorageSettings();
        buildMagicSettings();
        buildProductionSettings();
        buildJobSettings();
        buildBuildingSettings();
        buildWeightingSettings();
        buildProjectSettings();
        buildLoggingSettings(scriptContentNode, "");

        let collapsibles = document.querySelectorAll("#script_settings .script-collapsible");
        for (let i = 0; i < collapsibles.length; i++) {
            collapsibles[i].addEventListener("click", function() {
                this.classList.toggle("script-contentactive");
                let content = this.nextElementSibling;
                if (content.style.display === "block") {
                    settingsRaw[collapsibles[i].id] = true;
                    content.style.display = "none";

                    let search = content.getElementsByClassName("script-searchsettings");
                    if (search.length > 0) {
                        search[0].value = "";
                        filterBuildingSettingsTable();
                    }
                } else {
                    settingsRaw[collapsibles[i].id] = false;
                    content.style.display = "block";
                    content.style.height = null;
                    content.style.height = content.offsetHeight + "px";
                }

                updateSettingsFromState();
            });
        }

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function resetTabHeight(tab) {
        let content = document.querySelector(`#script_${tab} .script-content`);
        content.style.height = null;
        content.style.height = content.offsetHeight + "px";
    }

    function buildImportExport() {
        let importExportNode = $(".importExport").last();
        if (importExportNode === null) {
            return;
        }

        if (document.getElementById("script_settingsImport") !== null) {
            return;
        }

        importExportNode.append(' <button id="script_settingsImport" class="button">Import Script Settings</button>');

        $('#script_settingsImport').on("click", function() {
            if ($('#importExport').val().length > 0) {
                //let saveState = JSON.parse(LZString.decompressFromBase64($('#importExport').val()));
                let saveState = JSON.parse($('#importExport').val());
                if (saveState && typeof saveState === "object" && (saveState.scriptName === "TMVictor" || $.isEmptyObject(saveState))) {
                    let evals = [];
                    Object.values(saveState.overrides ?? []).forEach(list => list.forEach(override => {
                        if (override.type1 === "Eval") {
                            evals.push(override.arg1);
                        }
                        if (override.type2 === "Eval") {
                            evals.push(override.arg2);
                        }
                    }));

                    Object.values(saveState.overrides?.log_prestige_format ?? []).forEach(prestige_log_format_override => {
                        if (prestige_log_format_override.ret.includes("{eval:")) {
                            evals.push(prestige_log_format_override.ret);
                        }
                    });

                    if ((saveState.log_prestige_format ?? "").includes("{eval:")) {
                        evals.push(saveState.log_prestige_format);
                    }

                    if (evals.length > 0 && !confirm("Warning! Imported settings includes evaluated code, which will have full access to browser page, and can be potentially dangerous.\nOnly continue if you trust the source. Injected code:\n" + evals.join("\n"))) {
                        return;
                    }
                    console.log("Importing script settings");
                    settingsRaw = saveState;
                    updateStandAloneSettings();
                    updateStateFromSettings();
                    updateSettingsFromState();
                    removeScriptSettings();
                    removeMechInfo();
                    removeStorageToggles();
                    removeMarketToggles();
                    removeArpaToggles();
                    removeCraftToggles();
                    removeBuildingToggles();
                    removeEjectToggles();
                    removeSupplyToggles();
                    $('#autoScriptContainer').remove();
                    updateUI();
                    buildFilterRegExp();
                    $('#importExport').val("");
                }
            }
        });

        importExportNode.append(' <button id="script_settingsExport" class="button">Export Script Settings</button>');

        $('#script_settingsExport').on("click", function() {
            //$('#importExport').val(LZString.compressToBase64(JSON.stringify(global)));
            console.log("Exporting script settings");
            $('#importExport').val(JSON.stringify(settingsRaw));
            $('#importExport').select();
            document.execCommand('copy');
        });
    }

    function buildSettingsSection(sectionId, sectionName, resetFunction, updateSettingsContentFunction) {
        $("#script_settings").append(`
          <div id="script_${sectionId}Settings" style="margin-top: 10px;">
            <h3 id="${sectionId}SettingsCollapsed" class="script-collapsible text-center has-text-success">${sectionName} Settings</h3>
            <div class="script-content">
              <div style="margin-top: 10px;"><button id="script_reset${sectionId}" class="button">Reset ${sectionName} Settings</button></div>
              <div style="margin-top: 10px; margin-bottom: 10px;" id="script_${sectionId}Content"></div>
            </div>
          </div>`);

        updateSettingsContentFunction();

        if (!settingsRaw[sectionId + "SettingsCollapsed"]) {
            let element = document.getElementById(sectionId + "SettingsCollapsed");
            element.classList.toggle("script-contentactive");
            element.nextElementSibling.style.display = "block";
        }

        $("#script_reset" + sectionId).on("click", genericResetFunction.bind(null, resetFunction, sectionName));
    }

    function buildSettingsSection2(parentNode, secondaryPrefix, sectionId, sectionName, resetFunction, updateSettingsContentFunction) {
        if (secondaryPrefix !== "") {
            parentNode.append(`<div style="margin-top: 10px; margin-bottom: 10px;" id="script_${secondaryPrefix + sectionId}Content"></div>`);
        } else {
            parentNode.append(`
              <div id="script_${sectionId}Settings" style="margin-top: 10px;">
                <h3 id="${sectionId}SettingsCollapsed" class="script-collapsible text-center has-text-success">${sectionName} Settings</h3>
                <div class="script-content">
                  <div style="margin-top: 10px;"><button id="script_reset${sectionId}" class="button">Reset ${sectionName} Settings</button></div>
                  <div style="margin-top: 10px; margin-bottom: 10px;" id="script_${sectionId}Content"></div>
                </div>
              </div>`);

            if (!settingsRaw[sectionId + "SettingsCollapsed"]) {
                let element = document.getElementById(sectionId + "SettingsCollapsed");
                element.classList.toggle("script-contentactive");
                element.nextElementSibling.style.display = "block";
            }

            $("#script_reset" + sectionId).on("click", genericResetFunction.bind(null, resetFunction, sectionName));
        }

        updateSettingsContentFunction(secondaryPrefix);
    }

    function genericResetFunction(resetFunction, sectionName) {
        if (confirm("Are you sure you wish to reset " + sectionName + " Settings?")) {
            resetFunction();
        }
    }

    function addStandardHeading(node, heading) {
        node.append(`<div style="margin-top: 5px; width: 600px; text-align: left;"><span class="has-text-danger" style="margin-left: 10px;">${heading}</span></div>`);
    }

    function addSettingsHeader1(node, headerText) {
        node.append(`<div style="margin: 4px; width: 100%; display: inline-block; text-align: left;"><span class="has-text-success" style="font-weight: bold;">${headerText}</span></div>`);
    }

    function addSettingsHeader2(node, headerText) {
        node.append(`<div style="margin: 2px; width: 90%; display: inline-block; text-align: left;"><span class="has-text-caution">${headerText}</span></div>`);
    }

    const prestigeTypes = [
        {val: "none", label: "None", hint: "Endless game"},
        {val: "mad", short_label: "MAD", label: "Mutual Assured Destruction", hint: "MAD prestige once MAD has been researched and all soldiers are home"},
        {val: "bioseed", label: "Bioseed", hint: "Launches the bioseeder ship to perform prestige when required probes have been constructed"},
        {val: "cataclysm", label: "Cataclysm", hint: "Perform cataclysm reset by researching Dial It To 11 once available"},
        {val: "whitehole", label: "Whitehole", hint: "Infuses the blackhole with exotic materials to perform prestige"},
        {val: "vacuum", short_label: "Vacuum", label: "Vacuum Collapse", hint: "Build Mana Syphons until the end"},
        {val: "apocalypse", label: "AI Apocalypse", hint: "Perform AI Apocalypse reset by researching Protocol 66 once available"},
        {val: "ascension", label: "Ascension", hint: "Allows research of Incorporeal Existence and Ascension. Ascension Machine is managed by autoPower. Disable autoPrestige if you want to change custom race. Otherwise current one will be used , or default one if there's no current."},
        {val: "demonic", short_label: "DI", label: "Demonic Infusion", hint: "Sacrifice your entire civilization to absorb the essence of a greater demon lord"},
        {val: "terraform", label: "Terraform", hint: "Create new planet by building and powering Terraformer. Atmosphere Terraformer is managed by autoPower. Disable autoPrestige if you want to change custom planet. Otherwise current one will be used , or default one if there's no current. "},
        {val: "matrix", label: "Matrix", hint: "Build a computer simulation and trap your entire civilization in it"},
        {val: "retire", label: "Retirement", hint: "Retire and enjoy the easy life."},
        {val: "eden", label: "Eden", hint: "Build Garden Of Eden."}];

    const prestigeOptions = buildSelectOptions(prestigeTypes);

    const checkCompare = {
        "==": (a, b) => a == b,
        "!=": (a, b) => a != b,
        ">": (a, b) => a > b,
        "<": (a, b) => a < b,
        ">=": (a, b) => a >= b,
        "<=": (a, b) => a <= b,
        "===": (a, b) => a === b,
        "!==": (a, b) => a !== b,
        "AND": (a, b) => a && b,
        "OR": (a, b) => a || b,
        "NAND": (a, b) => !(a && b),
        "NOR": (a, b) => !(a || b),
        "XOR": (a, b) => !a != !b,
        "XNOR": (a, b) => !a == !b,
        "AND!": (a, b) => a && !b,
        "OR!": (a, b) => a || !b,
        "A?B": (a, b) => a,
        "!A?B": (a, b) => !a,
    }

    const checkCustom = {
        "A?B": "Special check, uses Var2 as result if Var1 is truthy",
        "!A?B": "Special check, uses Var2 as result if Var1 is falsy",
    }

    const argType = {
        building: {def: "city-farm", arg: "list", options: {list: buildingIds, name: "name", id: "_vueBinding"}},
        research: {def: "tech-mad", arg: "list", options: {list: techIds, name: "name", id: "_vueBinding"}},

        trait: {def: "kindling_kindred", arg: "list_cb", options: () =>
          Object.fromEntries(Object.entries(game.traits).map(([id, trait]) => [id, {name: trait.name, id: id}]))},

        genus: {def: "humanoid", arg: "select_cb", options: () =>
          [{val: "organism", label: game.loc(`race_protoplasm`)},
           ...Object.values(game.races).map(r => r.type).filter((g, i, a) => g && g !== "organism" && a.indexOf(g) === i).map(g =>
          ({val: g, label: game.loc(`genelab_genus_${g}`)}))]},
        genus_ss: {def: "humanoid", arg: "select_cb", options: () =>
          [{val: "none", label: game.loc(`genelab_genus_none`)},
           ...Object.values(game.races).map(r => r.type).filter((g, i, a) => g && g !== "organism" && g !== "synthetic" && a.indexOf(g) === i).map(g =>
          ({val: g, label: game.loc(`genelab_genus_${g}`)}))]},
        project: {def: "arpalaunch_facility", arg: "select_cb", options: () => Object.values(arpaIds).map(p =>
          ({val: p._vueBinding, label: p.name}))},
        job: {def: "unemployed", arg: "select_cb", options: () => Object.values(jobIds).map(j =>
          ({val: j._originalId, label: j._originalName}))},
        job_servant: {def: "farmer", arg: "select_cb", options: () => Object.values(jobIds).filter(j => j.is.serve).map(j =>
          ({val: j._originalId, label: j._originalName}))},
        resource: {def: "Food", arg: "select_cb", options: () => Object.values(resources).map(r =>
          ({val: r._id, label: r.name}))},
        race: {def: "species", arg: "select_cb", options: () =>
          [{val: "species", label: "Current Race", hint: "Current race"},
           {val: "gods", label: "Fanaticism Race", hint: "Gods race"},
           {val: "old_gods", label: "Deify Race", hint: "Old gods race"},
           {val: "srace", label: "Imitation Race", hint: "Imitation trait race"},
           {val: "protoplasm", label: "Protoplasm", hint: "Race is not chosen yet"},
           ...Object.values(races).map(race =>
          ({val: race.id, label: race.name, hint: race.desc}))]},
        challenge: {def: "junker", arg: "select_cb", options: () => challenges.flat().map(c =>
          ({val: c.trait, label: game.loc(`evo_challenge_${c.id}`), hint: game.loc(`evo_challenge_${c.id}_effect`)}))},
        universe: {def: "standard", arg: "select_cb", options: () =>
          [{val: "bigbang", label: "Big Bang", hint: "Universe is not chosen yet"},
           ...universes.map(u =>
          ({val: u, label: game.loc(`universe_${u}`), hint: game.loc(`universe_${u}_desc`)}))]},
        government: {def: "anarchy", arg: "select_cb", options: () => Object.keys(GovernmentManager.Types).map(g =>
          ({val: g, label: game.loc(`govern_${g}`), hint: game.loc(`govern_${g}_desc`)}))},
        governor: {def: "none", arg: "select_cb", options: () =>
          [{val: "none", label: "None", hint: "No governor selected"},
           ...governors.map(id =>
          ({val: id, label: game.loc(`governor_${id}`), hint: game.loc(`governor_${id}_desc`)}))]},
        queue: {def: "queue", arg: "select_cb", options: () =>
          [{val: "queue", label: "Building", hint: "Buildings and projects queue"},
           {val: "r_queue", label: "Research", hint: "Research queue"},
           {val: "evo", label: "Evolution", hint: "Evolution queue"}]},
        date: {def: "day", arg: "select_cb", options: () =>
          [{val: "day", label: "Day (Year)", hint: "Day of year"},
           {val: "moon", label: "Day (Month)", hint: "Day of month (0-27 range)"},
           {val: "total", label: "Day (Total)", hint: "Day of run"},
           {val: "year", label: "Year", hint: "Year of run"},
           {val: "orbit", label: "Orbit", hint: "Planet orbit in days"},
           {val: "season", label: "Season", hint: "Current season (0 - Spring, 1 - Summer, 2 - Fall, 3 - Winter)"},
           {val: "temp", label: "Temperature", hint: "Current temperature (0 - Cold, 1 - Normal, 2 - Hot)"},
           {val: "impact", label: "Impact", hint: "Days remaining before Moon Impact, for Orbit Decay scenario"}]},
        soldiers: {def: "workers", arg: "select_cb", options: () =>
          [{val: "workers", label: "Total Soldiers"},
           {val: "max", label: "Total Soldiers Max"},
           {val: "currentCityGarrison", label: "City Soldiers"},
           {val: "maxCityGarrison", label: "City Soldiers Max"},
           {val: "hellSoldiers", label: "Hell Soldiers"},
           {val: "hellGarrison", label: "Hell Garrison"},
           {val: "hellPatrols", label: "Hell Patrols"},
           {val: "hellPatrolSize", label: "Hell Patrol Size"},
           {val: "wounded", label: "Wounded Soldiers"},
           {val: "deadSoldiers", label: "Dead Soldiers"},
           {val: "crew", label: "Ship Crew"},
           {val: "mercenaryCost", label: "Mercenary Cost"}]},
        tab: {def: "civTabs1", arg: "select_cb", options: () =>
          [{val: "civTabs0", label: game.loc('tab_evolve')},
           {val: "civTabs1", label: game.loc('tab_civil')},
           {val: "civTabs2", label: game.loc('tab_civics')},
           {val: "civTabs3", label: game.loc('tab_research')},
           {val: "civTabs4", label: game.loc('tab_resources')},
           {val: "civTabs5", label: game.loc('tech_arpa')},
           {val: "civTabs6", label: game.loc('mTabStats')},
           {val: "civTabs7", label: game.loc('tab_settings')}]},
        biome: {def: "grassland", arg: "select_cb", options: () => biomeList.map(b =>
          ({val: b, label: game.loc(`biome_${b}_name`)}))},
        ptrait: {def: "", arg: "select_cb", options: () =>
          [{val: "", label: "None", hint: "Planet have no trait"},
           ...traitList.slice(1).map(t =>
          ({val: t, label: game.loc(`planet_${t}`)}))]},
        other: {def: "rname", arg: "select_cb", options: () =>
          [{val: "rname", label: "Race Name", hint: "Ingame name of current race as string."},
           {val: "tpfleet", label: "Fleet Size", hint: "Amount of ships in True Path fleet as number."},
           {val: "mrelay", label: "Mass Relay charge", hint: "Charge percentage of the Mass Relay (0 = 0%, 0.5 = 50%, 1 = 100%"},
           {val: "satcost", label: "Satellite Cost", hint: "Money cost of next Swarm Satellite"},
           {val: "bcar", label: "Broken Cars", hint: "Amount of broken Surveyour Carports"},
           {val: "alevel", label: "Active challenges", hint: "Amount of active challenges"},
           {val: "tknow", label: "Tech Knowledge", hint: "Knowledge needed for most expensive unlocked research"}]},
    }
    const argMap = {
        race: (r) => r === "species" || r === "gods" || r === "old_gods" ? game.global.race[r] :
                     r === "srace" ? (game.global.race.srace ?? "protoplasm") :
                     r,
        date: (d) => d === "total" ? game.global.stats.days :
                     d === "impact" ? (game.global.race['orbit_decay'] ? game.global.race['orbit_decay'] - game.global.stats.days : -1) :
                     game.global.city.calendar[d],
        other: (o) => o === "rname" ? (game.races[game.global.race.species === "protoplasm" && game.global.race.evoFinalMenu ? game.global.race.evoFinalMenu : game.global.race.species].name) :
                      o === "tpfleet" ? (game.global.space.shipyard?.ships?.length ?? 0) :
                      o === "mrelay" ? (game.global.space.m_relay?.charged / 10000.0 ?? 0) :
                      o === "satcost" ? (buildings.SunSwarmSatellite.cost.Money ?? 0) :
                      o === "bcar" ? (game.global.portal.carport?.damaged ?? 0) :
                      o === "alevel" ? (game.alevel() - 1) :
                      o === "tknow" ? (state.knowledgeRequiredByTechs) : o,
    }
    // TODO: Make trigger use all this checks, migration will be a bit tedius, but doable
    const checkTypes = {
        String: { fn: (v) => v, arg: "string", def: "none", desc: "Returns string" },
        Number: { fn: (v) => v, arg: "number", def: 0, desc: "Returns number" },
        Boolean: { fn: (v) => v, arg: "boolean", def: false, desc: "Returns boolean" },
        SettingDefault: { fn: (s) => settingsRaw[s], arg: "string", def: "masterScriptToggle", desc: "Returns default value of setting, types varies" },
        SettingCurrent: { fn: (s) => settings[s], arg: "string", def: "masterScriptToggle", desc: "Returns current value of setting, types varies" },
        Eval: { fn: (s) => fastEval(s), arg: "string", def: "Math.PI", desc: "Returns result of evaluating code" },
        BuildingUnlocked: { fn: (b) => buildingIds[b].isUnlocked(), ...argType.building, desc: "Return true when building is unlocked" },
        BuildingClickable: { fn: (b) => buildingIds[b].isClickable(), ...argType.building, desc: "Return true when building have all required resources, and can be purchased" },
        BuildingAffordable: { fn: (b) => buildingIds[b].isAffordable(true), ...argType.building, desc: "Return true when building is affordable, i.e. costs of all resources below storage caps" },
        BuildingCount: { fn: (b) => buildingIds[b].count, ...argType.building, desc: "Returns amount of buildings as number" },
        BuildingEnabled: { fn: (b) => buildingIds[b].stateOnCount, ...argType.building, desc: "Returns amount of powered buildings as number" },
        BuildingDisabled: { fn: (b) => buildingIds[b].stateOffCount, ...argType.building, desc: "Returns amount of unpowered buildings as number" },
        BuildingQueued: { fn: (b) => state.queuedTargetsAll.includes(buildingIds[b]), ...argType.building, desc: "Returns true when building in queue" },
        ProjectUnlocked: { fn: (p) => arpaIds[p].isUnlocked(), ...argType.project, desc: "Return true when project is unlocked" },
        ProjectCount: { fn: (p) => arpaIds[p].count, ...argType.project, desc: "Returns amount of projects as number" },
        ProjectProgress: { fn: (p) => arpaIds[p].progress, ...argType.project, desc: "Returns progress of projects as number" },
        JobUnlocked: { fn: (j) => jobIds[j].isUnlocked(), ...argType.job, desc: "Returns true when job is unlocked" },
        JobCount: { fn: (j) => jobIds[j].count, ...argType.job, desc: "Returns current amount of employees(both workers, and servants) as number" },
        JobMax: { fn: (j) => jobIds[j].max, ...argType.job, desc: "Returns maximum amount of assigned workers as number" },
        JobWorkers: { fn: (j) => jobIds[j].workers, ...argType.job, desc: "Returns current amount of workers as number" },
        JobServants: { fn: (j) => jobIds[j].servants, ...argType.job_servant, desc: "Returns current amount of servants as number" },
        ResearchUnlocked:  { fn: (r) => techIds[r].isUnlocked(), ...argType.research, desc: "Returns true when research is unlocked" },
        ResearchComplete:  { fn: (r) => techIds[r].isResearched(), ...argType.research, desc: "Returns true when research is complete" },
        ResourceUnlocked: { fn: (r) => resources[r].isUnlocked(), ...argType.resource, desc: "Returns true when resource or support is unlocked" },
        ResourceQuantity: { fn: (r) => resources[r].currentQuantity, ...argType.resource, desc: "Returns current amount of resource or support as number" },
        ResourceStorage: { fn: (r) => resources[r].maxQuantity, ...argType.resource, desc: "Returns maximum amount of resource or support as number. Power returns 'Disabled' amount." },
        ResourceMaxCost: { fn: (r) => resources[r].maxCost, ...argType.resource, desc: "Returns maximum cost of resource as number." },
        ResourceIncome: { fn: (r) => resources[r].rateOfChange, ...argType.resource, desc: "Returns current income of resource or unused support as number" }, // rateOfChange holds full diff of resource at the moment when overrides checked
        ResourceRatio: { fn: (r) => resources[r].storageRatio, ...argType.resource, desc: "Returns storage ratio of resource as number. Number 0.5 means that storage is 50% full, and such." },
        ResourceSatisfied: { fn: (r) => resources[r].usefulRatio >= 1, ...argType.resource, desc: "Returns true when current amount of resource above maximum costs" },
        ResourceSatisfyRatio: { fn: (r) => resources[r].usefulRatio, ...argType.resource, desc: "Returns satisfy ratio of resource. Number 0.5 means that storead amount equal half of maximum costs" },
        ResourceDemanded: { fn: (r) => resources[r].isDemanded(), ...argType.resource, desc: "Returns true when resource is demanded, i.e. missed by some prioritized task, such as queue or trigger" },
        RaceId: { fn: (r) => argMap.race(r), ...argType.race, desc: "Returns ID of selected race as string" },
        RacePillared: { fn: (r) => game.global.pillars[argMap.race(r)] >= game.alevel(), ...argType.race, desc: "Returns true when selected race pillared at current star level" },
        RaceGenus: { fn: (g) => races[game.global.race.species]?.genus === g, ...argType.genus, desc: "Returns true when playing selected genus" },
        MimicGenus: { fn: (g) => (game.global.race.ss_genus ?? 'none') === g, ...argType.genus_ss, desc: "Returns true when mimicking selected genus" },
        TraitLevel: { fn: (t) => game.global.race[t] ?? 0, ...argType.trait, desc: "Returns trait level as number" },
        ResetType: { fn: (r) => settings.prestigeType === r, arg: "select", options: prestigeOptions, def: "mad", desc: "Returns true when selected reset is active" },
        Challenge: { fn: (c) => game.global.race[c] ? true : false, ...argType.challenge, desc: "Returns true when selected challenge is active" },
        Universe: { fn: (u) => game.global.race.universe === u, ...argType.universe, desc: "Returns true when playing in selected universe" },
        Government: { fn: (g) => game.global.civic.govern.type === g, ...argType.government, desc: "Returns true when selected government is active" },
        Governor: { fn: (g) => getGovernor() === g, ...argType.governor, desc: "Returns true when selected governor is active" },
        Queue: { fn: (q) => q === "evo" ? settingsRaw.evolutionQueue.length : game.global[q].queue.length, ...argType.queue, desc: "Returns amount of items in queue as number" },
        Date: { fn: (d) => argMap.date(d), ...argType.date, desc: "Returns ingame date as number" },
        Soldiers: { fn: (s) => WarManager[s], ...argType.soldiers, desc: "Returns amount of soldiers as number" },
        PlanetBiome: { fn: (b) => game.global.city.biome === b, ...argType.biome, desc: "Returns true when playing in selected biome" },
        PlanetTrait: { fn: (t) => game.global.city.ptrait.includes(t), ...argType.ptrait, desc: "Returns true when planet have selected trait" },
        Other: { fn: (o) => argMap.other(o), ...argType.other, desc: "Other uncategorized variables" },
    }

    // Eval shortener
    function _(check, arg){
        return checkTypes[check].fn(arg);
    }

    function openOverrideModal(event) {
        if (event[overrideKey]) {
            event.preventDefault();
            openOptionsModal(event.data.label, function(modal) {
                modal.append(`<div style="margin-top: 10px; margin-bottom: 10px;" id="script_${event.data.name}Modal"></div>`);
                $('.script-modal-content').addClass('override-modal');
                buildOverrideSettings(event.data.name, event.data.type, event.data.options);
            });
        }
    }

    function buildOverrideSettings(settingName, type, options) {
        const rebuild = () => buildOverrideSettings(settingName, type, options);
        let overrides = settingsRaw.overrides[settingName] ?? [];

        let currentNode = $(`#script_${settingName}Modal`);
        currentNode.empty().off("*");

        currentNode.append(`
          <table style="width:100%; text-align: left">
            <tr>
              <th class="has-text-warning" colspan="2">Variable 1</th>
              <th class="has-text-warning" colspan="1">Check</th>
              <th class="has-text-warning" colspan="2">Variable 2</th>
              <th class="has-text-warning" colspan="3">Result</th>
            </tr>
            <tr>
              <th class="has-text-warning" style="width:16%">Type</th>
              <th class="has-text-warning" style="width:16%">Value</th>
              <th class="has-text-warning" style="width:10%"></th>
              <th class="has-text-warning" style="width:16%">Type</th>
              <th class="has-text-warning" style="width:16%">Value</th>
              <th class="has-text-warning" style="width:14%"></th>
              <th style="width:12%"></th>
            </tr>
            <tbody id="script_${settingName}ModalTable"></tbody>
          </table>`);

        let newTableBodyText = "";
        for (let i = 0; i < overrides.length; i++) {
            newTableBodyText += `<tr id="script_${settingName}_o${i}" value="${i}" class="script-draggable"><td style="width:16%"></td><td style="width:16%"></td><td style="width:10%"></td><td style="width:16%"></td><td style="width:16%"></td><td style="width:14%"></td><td style="width:12%"><span class="script-lastcolumn"></span></td></tr>`;
        }

        let listField = typeof settingsRaw[settingName] === "object";
        let note = listField ?
          "All values passed checks will be added or removed from list":
          "First value passed check will be used. Default value:";
        let note_2 = "The current value:";

        let current = listField ?
         `<td style="width:32%" colspan="2">${note_2}</td>
          <td style="width:56%" colspan="4"></td>`:
         `<td style="width:74%" colspan="5">${note_2}</td>
          <td style="width:14%"></td>`;

        newTableBodyText += `
          <tr id="script_${settingName}_d" class="unsortable">
            <td style="width:74%" colspan="5">${note}</td>
            <td style="width:14%"></td>
            <td style="width:12%"><a class="button is-small" style="width: 26px; height: 26px"><span>+</span></a></td>
          </tr>
          <tr id="script_override_true_value" class="unsortable" value="${settingName}" type="${type}">
            ${current}
            <td style="width:12%"></td>
          </tr>`;
        let tableBodyNode = $(`#script_${settingName}ModalTable`);
        tableBodyNode.append($(newTableBodyText));

        // Default input
        if (!listField) {
            $(`#script_${settingName}_d td:eq(1)`)
              .append(buildInputNode(type, options, settingsRaw[settingName], function(result) {
                  settingsRaw[settingName] = result;
                  updateSettingsFromState();

                  let retType = typeof result === "boolean" ? "checked" : "value";
                  $(".script_" + settingName).prop(retType, settingsRaw[settingName]);
              }));
        }
        $(`#script_override_true_value td:eq(1)`).append(buildInputNodeForDisplay(type, options, settings[settingName]));

        // Add button
        $(`#script_${settingName}_d a`).on('click', function() {
            if (!settingsRaw.overrides[settingName]) {
                settingsRaw.overrides[settingName] = [];
                $(".script_bg_" + settingName).addClass("inactive-row");
            }
            settingsRaw.overrides[settingName].push({type1: "Boolean", arg1: true, type2: "Boolean", arg2: false, cmp: "==", ret: settingsRaw[settingName]})
            updateSettingsFromState();
            rebuild();
        });

        for (let i = 0; i < overrides.length; i++) {
            let override = overrides[i];
            let tableElement = $(`#script_${settingName}_o${i}`).children().eq(0);

            tableElement.append(buildConditionType(override, 1, rebuild));
            tableElement = tableElement.next();
            tableElement.append(buildConditionArg(override, 1));
            tableElement = tableElement.next();
            tableElement.append(buildConditionComparator(override, rebuild));
            tableElement = tableElement.next();
            tableElement.append(buildConditionType(override, 2, rebuild));
            tableElement = tableElement.next();
            tableElement.append(buildConditionArg(override, 2));
            tableElement = tableElement.next();
            if (!checkCustom[override.cmp]) {
                tableElement.append(buildConditionRet(override, type, options));
            }
            tableElement = tableElement.next();
            tableElement.append(buildConditionRemove(settingName, i, rebuild));
            tableElement.append(buildConditionDuplicate(settingName, i, rebuild));
            tableElement.append(buildConditionEvalize(settingName, i, rebuild));

        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let newOrder = tableBodyNode.sortable('toArray', {attribute: 'value'});
                settingsRaw.overrides[settingName] = newOrder.map((i) => settingsRaw.overrides[settingName][i]);

                updateSettingsFromState();
                rebuild();
            },
        });
    }

    function buildInputNode(type, options, value, callback) {
        switch (type) {
            case "string":
                return $(`
                  <input type="text" class="input is-small" style="height: 22px; width:100%"/>`)
                .val(value).on('change', function() {
                    callback(this.value);
                });
            case "number":
                return $(`
                  <input type="text" class="input is-small" style="height: 22px; width:100%"/>`)
                .val(value).on('change', function() {
                    let parsedValue = getRealNumber(this.value);
                    if (isNaN(parsedValue)) {
                        parsedValue = value;
                    }
                    this.value = parsedValue;
                    callback(parsedValue);
                })
            case "boolean":
                return $(`
                  <label tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;">
                    <input type="checkbox">
                    <span class="check" style="height:5px; max-width:15px"></span><span style="margin-left: 20px;"></span>
                  </label>`)
                .find('input').prop('checked', value).on('change', function() {
                    callback(this.checked);
                })
                .end();
            case "select":
                return $(`
                  <select style="width: 100%">${options}</select>`)
                .val(value).on('change', function() {
                    callback(this.value);
                });
            case "select_cb":
                return $(`
                  <select style="width: 100%">${buildSelectOptions(options())}</select>`)
                .val(value).on('change', function() {
                    callback(this.value);
                });
            case "list":
                return buildObjectListInput(options.list, options.name, options.id, value, callback);
            case "list_cb":
                return buildObjectListInput(options(), "name", "id", value, callback);
            default:
                return "";
        }
    }

    function buildInputNodeForDisplay(type, options, value) {
        switch (type) {
            case "string":
            case "number":
                return $(`
                  <input type="text" class="input is-small" style="height: 22px; width:100%" disabled="disabled"/>`)
                .val(value);
            case "boolean":
                return $(`
                  <label tabindex="0" disabled="disabled" class="switch is-disabled" style="position:absolute; margin-top: 8px; margin-left: 10px;">
                    <input type="checkbox"  disabled="disabled">
                    <span class="check" style="height:5px; max-width:15px"></span><span style="margin-left: 20px;"></span>
                  </label>`)
                .find('input').prop('checked', value).end();
            case "select":
                return $(`
                  <select style="width: 100%"  disabled="disabled" class="dropdown is-disabled">${options}</select>`)
                .val(value);
            case "list":
                return $(`
                  <span></span>`)
               .text(value.map(item => options.list[item].name).join(", "));
            default:
                return $(`
                  <span></span>`)
                .text(JSON.stringify(value));
        }
    }

    function changeDisplayInputNode(currentNode) {
        let type = currentNode.attr("type");
        let id = currentNode.attr("value");
        let value = settings[currentNode.attr("value")];
        let node = currentNode.find(`td:eq(1)>*:first-child`);
        switch (type) {
            case "string":
            case "number":
            case "select":
                return node.val(value);
            case "boolean":
                return node.find('input').prop('checked', value);
            case "list":
                if (id === "researchIgnore") {
                    return node.text(value.map(item => techIds[item].name).join(", "));
                } // else default
            default:
                return node.text(JSON.stringify(value));
        }
    }

    function buildConditionType(override, num, rebuild) {
        let types = Object.entries(checkTypes).map(([id, type]) => `<option value="${id}" title="${type.desc}">${id.replace(/([A-Z])/g, ' $1').trim()}</option>`).join();
        return $(`<select style="width: 100%">${types}</select>`)
        .val(override["type" + num])
        .on('change', function() {
            override["type" + num] = this.value;
            override["arg" + num] = checkTypes[this.value].def;
            updateSettingsFromState();
            rebuild();
        });
    }

    function buildConditionArg(override, num) {
        let check = checkTypes[override["type" + num]];
        return check ? buildInputNode(check.arg, check.options, override["arg" + num], function(result){
            override["arg" + num] = result;
            updateSettingsFromState();
        }) : "";
    }

    function buildConditionComparator(override, rebuild) {
        let types = Object.entries(checkCompare).map(([id, fn]) => `<option value="${id}" title="${checkCustom[id] ?? fn.toString().substr(10)}">${id}</option>`).join();
        return $(`<select style="width: 100%">${types}</select>`)
        .val(override.cmp)
        .on('change', function() {
            override.cmp = this.value;
            updateSettingsFromState();
            rebuild();
        });
    }

    function buildConditionRemove(settingName, id, rebuild) {
        return $(`<a class="button is-small" style="width: 26px; height: 26px"><span>-</span></a>`)
        .on('click', function() {
            settingsRaw.overrides[settingName].splice(id, 1);
            if (settingsRaw.overrides[settingName].length === 0) {
                delete settingsRaw.overrides[settingName];
                $(".script_bg_" + settingName).removeClass("inactive-row");
            }
            updateSettingsFromState();
            rebuild();
        });
    }

    function buildConditionDuplicate(settingName, id, rebuild) {
        return $(`<a class="button is-small" style="width: 26px; height: 26px"><span style="font-size: 1.2rem;">&#9282;</span></a>`)
        .on('click', function() {
            settingsRaw.overrides[settingName].splice(id, 0, {...settingsRaw.overrides[settingName][id]});
            updateSettingsFromState();
            rebuild();
        });
    }

    function buildConditionEvalize(settingName, id, rebuild) {
        return $(`<a class="button is-small" style="width: 26px; height: 26px"><span style="font-size: 0.9rem;">E</span></a>`)
        .on('click', function() {
            let override = settingsRaw.overrides[settingName][id];
            let check = checkCompare[override.cmp].toString().substr(10)
                .replace(/([ab])/g, (s, v) => {
                    let idx = v === "a" ? 1 : 2;
                    switch (override["type"+idx]) {
                        case "Number":
                        case "Boolean":
                            return override["arg"+idx];
                        case "Eval":
                            return `(${override["arg"+idx]})`;
                        case "String":
                            return JSON.stringify(override["arg"+idx]);
                        default:
                            return `_("${override["type"+idx]}",${JSON.stringify(override["arg"+idx])})`;
                    }
                });
            win.prompt("Eval of this condition:", check);
        });
    }

    function buildConditionRet(override, type, options) {
        return buildInputNode(type, options, override.ret, function(result) {
            override.ret = result;
            updateSettingsFromState();
        });
    }

    function buildObjectListInput(list, name, id, value, callback) {
        let listNode = $(`<input type="text" style="width:100%"></input>`);

        // Event handler
        let onChange = function(event, ui) {
            event.preventDefault();

            // If it wasn't selected from list
            if(ui.item === null){
                let foundItem = Object.values(list).find(obj => obj[name] === this.value);
                if (foundItem !== undefined){
                    ui.item = {label: this.value, value: foundItem[id]};
                }
            }

            if (ui.item !== null && Object.values(list).some(obj => obj[id] === ui.item.value)) {
                // We have an item to switch
                this.value = ui.item.label;
                callback(ui.item.value);
            } else if (list.hasOwnProperty(value)) {
                // Or try to restore old valid value
                this.value = list[value][name];
                callback(value);
            } else {
                // No luck, set it empty
                this.value = "";
                callback(null);
            }
        };

        listNode.autocomplete({
            minLength: 2,
            delay: 0,
            source: function(request, response) {
                let matcher = new RegExp($.ui.autocomplete.escapeRegex(request.term), "i");
                response(Object.values(list)
                  .filter(item => matcher.test(item[name]))
                  .map(item => ({label: item[name], value: item[id]})));
            },
            select: onChange, // Dropdown list click
            focus: onChange, // Arrow keys press
            change: onChange // Keyboard type
        });

        if (Object.values(list).some(obj => obj[id] === value)) {
            listNode.val(list[value][name]);
        }

        return listNode;
    }

    function addSettingsToggle(node, settingName, labelText, hintText, enabledCallBack, disabledCallBack) {
        return $(`
          <div class="script_bg_${settingName}" style="margin-top: 5px; width: 90%; display: inline-block; text-align: left;">
            <label title="${hintText}" tabindex="0" class="switch">
              <input class="script_${settingName}" type="checkbox" ${settingsRaw[settingName] ? " checked" : ""}><span class="check"></span>
              <span style="margin-left: 10px;">${labelText}</span>
            </label>
          </div>`)
        .toggleClass('inactive-row', Boolean(settingsRaw.overrides[settingName]))
        .on('change', 'input', function() {
            settingsRaw[settingName] = this.checked;
            updateSettingsFromState();

            $(".script_" + settingName).prop('checked', settingsRaw[settingName]);

            if (settingsRaw[settingName] && enabledCallBack) {
                enabledCallBack();
            }
            if (!settingsRaw[settingName] && disabledCallBack) {
                disabledCallBack();
            }
        })
        .on('click', {label: `${labelText} (${settingName})`, name: settingName, type: "boolean"}, openOverrideModal)
        .appendTo(node);

        if (settingsRaw[settingName] && enabledCallBack) {
            enabledCallBack();
        }
    }

    function addSettingsNumber(node, settingName, labelText, hintText) {
        return $(`
          <div class="script_bg_${settingName}" style="margin-top: 5px; display: inline-block; width: 90%; text-align: left;">
            <label title="${hintText}" tabindex="0">
              <span>${labelText}</span>
              <input class="script_${settingName}" type="text" style="text-align: right; height: 18px; width: 150px; float: right;" value="${settingsRaw[settingName]}"></input>
            </label>
          </div>`)
        .toggleClass('inactive-row', Boolean(settingsRaw.overrides[settingName]))
        .on('change', 'input', function() {
            let parsedValue = getRealNumber(this.value);
            if (!isNaN(parsedValue)) {
                settingsRaw[settingName] = parsedValue;
                updateSettingsFromState();
            }
            $(".script_" + settingName).val(settingsRaw[settingName]);
        })
        .on('click', {label: `${labelText} (${settingName})`, name: settingName, type: "number"}, openOverrideModal)
        .appendTo(node);
    }

    function addSettingsString(node, settingName, labelText, hintText) {
        return $(`
          <div class="script_bg_${settingName}" style="margin-top: 5px; display: inline-block; width: 90%; text-align: left;">
            <label title="${hintText}" tabindex="0">
              <span>${labelText}</span>
              <input class="script_${settingName}" type="text" style="text-align: right; height: 18px; width: 70%; float: right;" value="${settingsRaw[settingName]}"></input>
            </label>
          </div>`)
        .toggleClass('inactive-row', Boolean(settingsRaw.overrides[settingName]))
        .on('change', 'input', function() {
            settingsRaw[settingName] = this.value;
            updateSettingsFromState();
            $(".script_" + settingName).val(settingsRaw[settingName]);
        })
        .on('click', {label: `${labelText} (${settingName})`, name: settingName, type: "string"}, openOverrideModal)
        .appendTo(node);
    }

    function buildSelectOptions(optionsList) {
        return optionsList.map(item => `<option value="${item.val}" title="${item.hint ?? ""}">${item.label}</option>`).join();
    }

    function addSettingsSelect(node, settingName, labelText, hintText, optionsList) {
        let options = buildSelectOptions(optionsList);
        return $(`
          <div class="script_bg_${settingName}" style="margin-top: 5px; display: inline-block; width: 90%; text-align: left;">
            <label title="${hintText}" tabindex="0">
              <span>${labelText}</span>
              <select class="script_${settingName}" style="width: 150px; float: right;">
                ${options}
              </select>
            </label>
          </div>`)
        .toggleClass('inactive-row', Boolean(settingsRaw.overrides[settingName]))
        .find('select')
          .val(settingsRaw[settingName])
          .on('change', function() {
            settingsRaw[settingName] = this.value;
            updateSettingsFromState();

            $(".script_" + settingName).val(settingsRaw[settingName]);
          })
        .end()
        .on('click', {label: `${labelText} (${settingName})`, name: settingName, type: "select", options: options}, openOverrideModal)
        .appendTo(node);
    }

    function addSettingsList(node, settingName, labelText, hintText, list) {
        let listBlock = $(`
          <div class="script_bg_${settingName}" style="display: inline-block; width: 90%; margin-top: 6px;">
            <label title="${hintText}" tabindex="0">
              <span>${labelText}</span>
              <input type="text" style="height: 25px; width: 150px; float: right;" placeholder="Research...">
              <button class="button" style="height: 25px; float: right; margin-right: 4px; margin-left: 4px;">Remove</button>
              <button class="button" style="height: 25px; float: right;">Add</button>
            </label>
            <br>
            <textarea class="script_${settingName} textarea" style="margin-top: 12px" readonly></textarea>
          </div>`)
        .toggleClass('inactive-row', Boolean(settingsRaw.overrides[settingName]))
        .on('click', {label: `Add or Remove (${settingName})`, name: settingName, type: "list", options: {list: list, name: "name", id: "_vueBinding"}}, openOverrideModal)
        .appendTo(node);

        let selectedItem = "";

        let updateList = function() {
            let techsString = settingsRaw[settingName].map(id => Object.values(list).find(obj => obj._vueBinding === id).name).join(', ');
            $(".script_" + settingName).val(techsString);
        }

        let onChange = function(event, ui) {
            event.preventDefault();

            // If it wasn't selected from list
            if(ui.item === null){
                let typedName = Object.values(list).find(obj => obj.name === this.value);
                if (typedName !== undefined){
                    ui.item = {label: this.value, value: typedName._vueBinding};
                }
            }

            // We have an item to switch
            if (ui.item !== null && list.hasOwnProperty(ui.item.value)) {
                this.value = ui.item.label;
                selectedItem = ui.item.value;
            } else {
                this.value = "";
                selectedItem = null;
            }
        };

        listBlock.find('input').autocomplete({
            minLength: 2,
            delay: 0,
            source: function(request, response) {
                let matcher = new RegExp($.ui.autocomplete.escapeRegex(request.term), "i");
                response(Object.values(list)
                  .filter(item => matcher.test(item.name))
                  .map(item => ({label: item.name, value: item._vueBinding})));
            },
            select: onChange, // Dropdown list click
            focus: onChange, // Arrow keys press
            change: onChange // Keyboard type
        });

        listBlock.on('click', 'button:eq(1)', function() {
            if (selectedItem && !settingsRaw[settingName].includes(selectedItem)) {
                settingsRaw[settingName].push(selectedItem);
                settingsRaw[settingName].sort();
                updateSettingsFromState();
                updateList();
            }
        });

        listBlock.on('click', 'button:eq(0)', function() {
            if (selectedItem && settingsRaw[settingName].includes(selectedItem)) {
                settingsRaw[settingName].splice(settingsRaw[settingName].indexOf(selectedItem), 1);
                settingsRaw[settingName].sort();
                updateSettingsFromState();
                updateList();
            }
        });

        updateList();
    }

    function addInputCallbacks(node, settingKey) {
        return node
        .on('change', function() {
            let parsedValue = getRealNumber(this.value);
            if (!isNaN(parsedValue)) {
                settingsRaw[settingKey] = parsedValue;
                updateSettingsFromState();
            }
            $(".script_" + settingKey).val(settingsRaw[settingKey]);
        })
        .on('click', {label: `Number (${settingKey})`, name: settingKey, type: "number"}, openOverrideModal);
    }

    function addTableInput(node, settingKey) {
        node.addClass("script_bg_" + settingKey + (settingsRaw.overrides[settingKey] ? " inactive-row" : ""))
            .append(addInputCallbacks($(`<input class="script_${settingKey}" type="text" class="input is-small" style="height: 25px; width:100%" value="${settingsRaw[settingKey]}"/>`), settingKey));
    }

    function addToggleCallbacks(node, settingKey) {
        return node
        .on('change', 'input', function() {
            settingsRaw[settingKey] = this.checked;
            updateSettingsFromState();

            $(".script_" + settingKey).prop('checked', settingsRaw[settingKey]);
        })
        .on('click', {label: `Toggle (${settingKey})`, name: settingKey, type: "boolean"}, openOverrideModal);
    }

    function addTableToggle(node, settingKey) {
        node.addClass("script_bg_" + settingKey + (settingsRaw.overrides[settingKey] ? " inactive-row" : ""))
            .append(addToggleCallbacks($(`
          <label tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;">
            <input class="script_${settingKey}" type="checkbox"${settingsRaw[settingKey] ? " checked" : ""}>
            <span class="check" style="height:5px; max-width:15px"></span>
            <span style="margin-left: 20px;"></span>
          </label>`), settingKey));
    }

    function buildTableLabel(note, title = "", color = "has-text-info") {
        return $(`<span class="${color}" title="${title}" >${note}</span>`);
    }

    function resetCheckbox() {
        Array.from(arguments).forEach(item => $(".script_" + item).prop('checked', settingsRaw[item]));
    }

    function buildGeneralSettings() {
        let sectionId = "general";
        let sectionName = "General";

        let resetFunction = function() {
            resetGeneralSettings(true);
            updateSettingsFromState();
            updateGeneralSettingsContent();
            removeActiveTargetsUI();
            removePrestigeFromTopBar();

            resetCheckbox("masterScriptToggle", "showSettings", "autoPrestige", "displayPrestigeTypeInTopBar", "displayTotalDaysTypeInTopBar");
            // No need to call showSettings callback, it enabled if button was pressed, and will be still enabled on default settings
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateGeneralSettingsContent);
        buildActiveTargetsUI();
    }

    function updateGeneralSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_generalContent');
        currentNode.empty().off("*");

        addSettingsNumber(currentNode, "tickRate", "Script tick rate", "Script runs once per this amount of game ticks. Game tick every 250ms, thus with rate 4 script will run once per second. You can set it lower to make script act faster, or increase it if you have performance issues. Tick rate should be a positive integer.");
        addSettingsToggle(currentNode, "tickSchedule", "Schedule script ticks", "When enabled script will schedule its ticks to run after game ticks, instead of executing both at once. Splitting of long task allows browser to update UI in between of game and script ticks, making game run smoother, but less throttling-proof - that can make tick rate float inconsistently.");

        addSettingsHeader1(currentNode, "Prioritization");
        let priority = [{val: "ignore", label: "Ignore", hint: "Does nothing"},
                        {val: "save", label: "Save", hint: "Missing resources preserved from using."},
                        {val: "req", label: "Request", hint: "Production and buying of missing resources will be prioritized."},
                        {val: "savereq", label: "Request & Save", hint: "Missing resources will be prioritized, and preserved from using."}];

        addSettingsToggle(currentNode, "useDemanded", "Allow using prioritized resources for crafting", "When disabled script won't make craftables out of prioritized resources in foundry and factory.");
        addSettingsToggle(currentNode, "researchRequest", "Prioritize resources for Pre-MAD researches", "Readjust trade routes and production to resources required for unlocked and affordable researches. Works only with no active triggers, or queue. Missing resources will have 100 priority where applicable(autoMarket, autoGalaxyMarket, autoFactory, autoMiningDroid), or just 'top priority' where not(autoTax, autoCraft, autoCraftsmen, autoQuarry, autoMine, autoExtractor, autoSmelter).");
        addSettingsToggle(currentNode, "researchRequestSpace", "Prioritize resources for Space+ researches", "Readjust trade routes and production to resources required for unlocked and affordable researches. Works only with no active triggers, or queue. Missing resources will have 100 priority where applicable(autoMarket, autoGalaxyMarket, autoFactory, autoMiningDroid), or just 'top priority' where not(autoTax, autoCraft, autoCraftsmen, autoQuarry, autoMine, autoExtractor, autoSmelter).");
        addSettingsToggle(currentNode, "missionRequest", "Prioritize resources for missions", "Readjust trade routes and production to resources required for unlocked and affordable missions. Missing resources will have 100 priority where applicable(autoMarket, autoGalaxyMarket, autoFactory, autoMiningDroid), or just 'top priority' where not(autoTax, autoCraft, autoCraftsmen, autoQuarry, autoMine, autoExtractor, autoSmelter).");

        addSettingsSelect(currentNode, "prioritizeQueue", "Queue", "Alter script behaviour to speed up queued items, prioritizing missing resources.", priority);
        addSettingsSelect(currentNode, "prioritizeTriggers", "Triggers", "Alter script behaviour to speed up triggers, prioritizing missing resources.", priority);
        addSettingsSelect(currentNode, "prioritizeAdvTriggerHigh", "AdvTriggers (high priority)", "Alter script behaviour to speed up AdvTriggers with the current highest active or -1 priority.", priority);
        addSettingsSelect(currentNode, "prioritizeAdvTriggerLow", "AdvTriggers (low priority)", "Alter script behaviour to speed up AdvTriggers with non-highest or 0 priority.", priority);
        addSettingsSelect(currentNode, "prioritizeUnify", "Unification", "Alter script behaviour to speed up unification, prioritizing money required to purchase foreign cities.", priority);
        addSettingsSelect(currentNode, "prioritizeOuterFleet", "Ship Yard Blueprint (The True Path)", "Alter script behaviour to assist fleet building, prioritizing resources required for current design of ship.", priority);

        addSettingsHeader1(currentNode, "Auto clicker");
        addSettingsToggle(currentNode, "buildingAlwaysClick", "Always autoclick resources", "By default script will click only during early stage of autoBuild, to bootstrap production. With this toggled on it will continue clicking forever");
        addSettingsNumber(currentNode, "buildingClickPerTick", "Maximum clicks per tick", "Number of clicks performed at once, each script tick. Will not ever click more than needed to fill storage.");

        addSettingsHeader1(currentNode, "Additional UI");
        addSettingsToggle(currentNode, "activeTargetsUI", "Display detailed queue", "Add UI in right column to display currently active queued buildings, technologies, and triggers and their resources.", buildActiveTargetsUI, removeActiveTargetsUI);
        addSettingsToggle(currentNode, "displayPrestigeTypeInTopBar", "Display prestige type in top bar", "Show the currently selected prestige type in the top bar", updatePrestigeInTopBar, updatePrestigeInTopBar);
        addSettingsToggle(currentNode, "displayTotalDaysTypeInTopBar", "Display total days in top bar", "Show the total days next to this year's days", updateTotalDaysInTopBar, updateTotalDaysInTopBar);


        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildPrestigeSettings(parentNode, secondaryPrefix) {
        let sectionId = "prestige";
        let sectionName = "Prestige";

        let resetFunction = function() {
            resetPrestigeSettings(true);
            updateSettingsFromState();
            updatePrestigeSettingsContent(secondaryPrefix);
        };

        buildSettingsSection2(parentNode, secondaryPrefix, sectionId, sectionName, resetFunction, updatePrestigeSettingsContent);
    }

    function updatePrestigeSettingsContent(secondaryPrefix) {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $(`#script_${secondaryPrefix}prestigeContent`);
        currentNode.empty().off("*");

        currentNode.append(`
          <div style="display: inline-block; width: 90%; text-align: left; margin-bottom: 10px;">
            <label>
              <span>Prestige Type</span>
              <select class="script_prestigeType" style="height: 18px; width: 150px; float: right;">
                ${prestigeOptions}
              </select>
            </label>
          </div>`);

        currentNode.find('.script_prestigeType')
          .val(settingsRaw.prestigeType)
          .on('change', function() {
            // Special processing for prestige options. If they are ready to prestige then warn the user about enabling them.
            if (isPrestigeAllowed()) {
                let confirmationText = "";
                if (this.value === "mad" && haveTech("mad")) {
                    confirmationText = "MAD has already been researched.";
                } else if (this.value === "bioseed" && isBioseederPrestigeAvailable()) {
                    confirmationText = "Required probes are built, and bioseeder ship is ready to launch.";
                } else if (this.value === "cataclysm" && isCataclysmPrestigeAvailable()) {
                    confirmationText = "Dial It To 11 is unlocked. You may prestige immediately.";
                } else if (this.value === "whitehole" && isWhiteholePrestigeAvailable()) {
                    confirmationText = "Required mass is reached, and exotic infusion is unlocked.";
                } else if (this.value === "apocalypse" && isApocalypsePrestigeAvailable()) {
                    confirmationText = "Protocol 66 is unlocked.";
                } else if (this.value === "ascension" && (game.global.race['witch_hunter'] ? isWitchAscensionPrestigeAvailable() : isAscensionPrestigeAvailable())) {
                    confirmationText = (game.global.race['witch_hunter'] ? "Absorption Chamber is built and ready." : "Ascension machine is built and powered.");
                } else if (this.value === "demonic" && (game.global.race['witch_hunter'] ? isWitchAscensionPrestigeAvailable(true) : isDemonicPrestigeAvailable())) {
                    confirmationText = (game.global.race['witch_hunter'] ? "Absorption Chamber is built and ready." : "Required floor is reached, and demon lord is already dead.");
                } else if (this.value === "terraform" && buildings.RedTerraform.isUnlocked()) {
                    confirmationText = "Terraformer is built and powered.";
                } else if (this.value === "matrix" && buildings.TauStarBluePill.isUnlocked()) {
                    confirmationText = "Matrix is built and powered.";
                } else if (this.value === "retire" && buildings.TauGas2MatrioshkaBrain.count >= 1000
                                                   && buildings.TauGas2IgniteGasGiant.isUnlocked()
                                                   && buildings.TauGas2IgniteGasGiant.isAffordable()) {
                    confirmationText = "Ignition Device is built and ready.";
                } else if (this.value === "eden" && buildings.TauStarEden.isUnlocked()
                                                 && buildings.TauStarEden.isAffordable()) {
                    confirmationText = "Garden Of Eden is ready to build.";
                }
                if (confirmationText !== "") {
                    confirmationText += " You may prestige immediately. Are you sure you want to toggle this prestige?";
                    if (!confirm(confirmationText)) {
                        this.value = "none";
                    }
                }
            }
            settingsRaw.prestigeType = this.value;
            $(".script_prestigeType").val(settingsRaw.prestigeType);

            state.goal = "Standard";
            updateSettingsFromState();
        })
        .on('click', {label: "Prestige Type (prestigeType)", name: "prestigeType", type: "select", options: prestigeOptions}, openOverrideModal);

        addSettingsToggle(currentNode, "prestigeWaitAT", "Disable prestiging under Accelerated Time", "Delay reset until all accelerated time will be used, to avoid wasting it");
        addSettingsToggle(currentNode, "prestigeMADIgnoreArpa", "Ignore early game A.R.P.A.", "Disables building any A.R.P.A. projects until MAD is researched, or rival have appeared");
        addSettingsToggle(currentNode, "prestigeBioseedConstruct", "Ignore useless buildings", "Space Dock, Bioseeder Ship and Probes will be constructed only when Bioseed prestige enabled. World Collider won't be constructed during Bioseed. Jump Ship won't be constructed during Whitehole. Stellar Engine won't be constucted during Vacuum Collapse. Mana Syphon won't be constructed during Witch Hunter's Ascension and Demonic Infusion.");

        addSettingsHeader1(currentNode, "Mutual Assured Destruction");
        addSettingsToggle(currentNode, "prestigeMADWait", "Wait for maximum population", "Wait for maximum population and soldiers to maximize plasmids gain");
        addSettingsNumber(currentNode, "prestigeMADPopulation", "Required population", "Required number of workers and soldiers before performing MAD reset");

        addSettingsHeader1(currentNode, "Bioseed");
        addSettingsNumber(currentNode, "prestigeBioseedProbes", "Required probes", "Required number of probes before launching bioseeder ship");
        addSettingsNumber(currentNode, "prestigeGECK", "Required G.E.C.K", "Required number of G.E.C.K. for Bioseed. Unlike any other buildings G.E.C.K. won't ever be constructed during inappropriate runs, or above this number. To prevent losing plasmids. It can, however, be built with triggers - you should not build G.E.C.K with triggers, unless you absolutely sure you know what you're doing.");

        addSettingsHeader1(currentNode, "Whitehole");
        addSettingsToggle(currentNode, "prestigeWhiteholeSaveGems", "Save up Soul Gems for reset", "Save up enough Soul Gems for reset, only excess gems will be used. This option does not affect triggers.");
        addSettingsNumber(currentNode, "prestigeWhiteholeMinMass", "Minimum solar mass for reset", "Required minimum solar mass of blackhole before prestiging. Script do not stabilize on blackhole run, this number will need to be reached naturally");

        addSettingsHeader1(currentNode, "Ascension");
        addSettingsToggle(currentNode, "prestigeAscensionPillar", "Wait for Pillar", "Wait for Pillar before ascending, unless it was done earlier");

        addSettingsHeader1(currentNode, "Demonic Infusion");
        addSettingsNumber(currentNode, "prestigeDemonicFloor", "Minimum spire floor for reset", "Perform reset after climbing up to this spire floor");
        addSettingsNumber(currentNode, "prestigeDemonicPotential", "Maximum mech potential for reset", "Perform reset only if current mech team potential below given amount. Full bay of best mechs will have `1` potential. This allows to postpone reset if your team is still good after reaching target floor, and can quickly clear another floor");
        addSettingsToggle(currentNode, "prestigeDemonicBomb", "Use Dark Energy Bomb", "Kill Demon Lord with Dark Energy Bomb");

        addSettingsHeader1(currentNode, "Matrix");
        let cureStrat = [{val: "none", label: "None", hint: "Do not select strategy"},
                         {val: "strat1", label: game.loc(`tech_vax_strat1`), hint: game.loc(`tech_vax_strat1_effect`)},
                         {val: "strat2", label: game.loc(`tech_vax_strat2`), hint: game.loc(`tech_vax_strat2_effect`)},
                         {val: "strat3", label: game.loc(`tech_vax_strat3`), hint: game.loc(`tech_vax_strat3_effect`)},
                         {val: "strat4", label: game.loc(`tech_vax_strat4`), hint: game.loc(`tech_vax_strat4_effect`)}];
        addSettingsSelect(currentNode, "prestigeVaxStrat", "Vaccination Strategy", "Alter script behaviour to speed up queued items, prioritizing missing resources.", cureStrat);

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildGovernmentSettings(parentNode, secondaryPrefix) {
        let sectionId = "government";
        let sectionName = "Government";

        let resetFunction = function() {
            resetGovernmentSettings(true);
            updateSettingsFromState();
            updateGovernmentSettingsContent(secondaryPrefix);

            resetCheckbox("autoTax", "autoGovernment");
        };

        buildSettingsSection2(parentNode, secondaryPrefix, sectionId, sectionName, resetFunction, updateGovernmentSettingsContent);
    }

    function updateGovernmentSettingsContent(secondaryPrefix) {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $(`#script_${secondaryPrefix}governmentContent`);
        currentNode.empty().off("*");

        addSettingsNumber(currentNode, "generalRequestedTaxRate", "Forced tax rate", "Set tax rate as close to this value as possible, ignores morale. Set to -1 to disable this option");
        addSettingsNumber(currentNode, "generalMinimumTaxRate", "Minimum allowed tax rate", "Minimum tax rate for autoTax. Will still go below this amount if money storage is full");
        addSettingsNumber(currentNode, "generalMinimumMorale", "Minimum allowed morale", "Use this to set a minimum allowed morale. Remember that less than 100% can cause riots and weather can cause sudden swings");
        addSettingsNumber(currentNode, "generalMaximumMorale", "Maximum allowed morale", "Use this to set a maximum allowed morale. The tax rate will be raised to lower morale to this maximum");

        let governmentOptions = [{val: "none", label: "None", hint: "Do not select government"}, ...Object.keys(GovernmentManager.Types).filter(id => id !== "anarchy").map(id => ({val: id, label: game.loc(`govern_${id}`), hint: game.loc(`govern_${id}_desc`)}))];
        addSettingsSelect(currentNode, "govInterim", "Interim Government", "Temporary low tier government until you research other governments", governmentOptions);
        addSettingsSelect(currentNode, "govFinal", "Second Government", "Second government choice, chosen once becomes available. Can be the same as above", governmentOptions);
        addSettingsSelect(currentNode, "govSpace", "Space Government", "Government for bioseed+. Chosen once you researched Quantum Manufacturing. Can be the same as above", governmentOptions);

        let governorsOptions = [{val: "none", label: "None", hint: "Do not select governor"}, ...governors.map(id => ({val: id, label: game.loc(`governor_${id}`), hint: game.loc(`governor_${id}_desc`)}))];
        addSettingsSelect(currentNode, "govGovernor", "Governor", "Chosen governor will be appointed.", governorsOptions);

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildEvolutionSettings() {
        let sectionId = "evolution";
        let sectionName = "Evolution";

        let resetFunction = function() {
            resetEvolutionSettings(true);
            updateSettingsFromState();
            updateEvolutionSettingsContent();

            resetCheckbox("autoEvolution");
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateEvolutionSettingsContent);
    }

    function updateRaceWarning() {
        let race = races[settingsRaw.userEvolutionTarget];
        if (race && race.getCondition() !== '') {
            let suited = race.getHabitability();
            if (suited === 1) {
                $("#script_race_warning").html(`<span class="has-text-success">This race have special requirements: ${race.getCondition()}. This condition is met.</span>`);
            } else if (suited === 0) {
                $("#script_race_warning").html(`<span class="has-text-danger">Warning! This race have special requirements: ${race.getCondition()}. This condition is not met.</span>`);
            } else {
                $("#script_race_warning").html(`<span class="has-text-warning">Warning! This race have special requirements: ${race.getCondition()}. This condition is bypassed. Race will have ${100 - suited * 100}% penalty.</span>`);
            }
        } else {
            $("#script_race_warning").empty();
        }
    }

    function updateEvolutionSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_evolutionContent');
        currentNode.empty().off("*");

        // Target universe
        let universeOptions = [{val: "none", label: "None", hint: "Wait for user selection"},
                               ...universes.map(id => ({val: id, label: game.loc(`universe_${id}`), hint: game.loc(`universe_${id}_desc`)}))];
        addSettingsSelect(currentNode, "userUniverseTargetName", "Target Universe", "Chosen universe will be automatically selected after appropriate reset", universeOptions);

        // Target planet
        let planetOptions = [{val: "none", label: "None", hint: "Wait for user selection"},
                             {val: "habitable", label: "Most habitable", hint: "Picks most habitable planet, based on biome and trait"},
                             {val: "achieve", label: "Most achievements", hint: "Picks planet with most unearned achievements. Takes in account extinction achievements for planet exclusive races, and greatness achievements for planet biome, trait, and exclusive genus."},
                             {val: "weighting", label: "Highest weighting", hint: "Picks planet with highest weighting. Should be configured in Planet Weighting Settings section."}];
        addSettingsSelect(currentNode, "userPlanetTargetName", "Target Planet", "Chosen planet will be automatically selected after appropriate reset. Warning! Script ignores changes made by G.E.C.K., you need to select planet manually after using it.", planetOptions);

        // Target evolution
        let raceOptions = [{val: "auto", label: "Auto Achievements", hint: "Picks race giving most achievements upon completing run. Tracks all achievements limited to specific races and resets. Races unique to current planet biome are prioritized, when available."},
                           ...Object.values(races).map(race => (
                           {val: race.id, label: race.name, hint: race.desc}))];
        addSettingsSelect(currentNode, "userEvolutionTarget", "Target Race", "Chosen race will be automatically selected during next evolution", raceOptions)
          .on('change', 'select', function() {
            state.evolutionTarget = null;
            updateRaceWarning();
            resetTabHeight("evolutionSetting");
        });

        currentNode.append(`<div><span id="script_race_warning"></span></div>`);
        updateRaceWarning();

        addSettingsToggle(currentNode, "evolutionAutoUnbound", "Allow unbound races", "Allow Auto Achievement to pick biome restricted races on unsuited biomes, after getting unbound.");
        addSettingsToggle(currentNode, "evolutionBackup", "Soft Reset", "Perform soft resets until you'll get chosen race. Has no effect after getting mass extinction perk.");

        // Challenges
        for (let i = 0; i < challenges.length; i++) {
            let set = challenges[i];
            addSettingsToggle(currentNode, `challenge_${set[0].id}`,
              set.map(c => game.loc(`evo_challenge_${c.id}`)).join(" | "),
              set.map(c => game.loc(`evo_challenge_${c.id}_effect`)).join("&#xA;"));
        }

        addStandardHeading(currentNode, "Evolution Queue");
        addSettingsToggle(currentNode, "evolutionQueueEnabled", "Queue Enabled", "When enabled script with evolve with queued settings, from top to bottom. During that script settings will be overriden with settings stored in queue. Queued target will be removed from list after evolution.");
        addSettingsToggle(currentNode, "evolutionQueueRepeat", "Repeat Queue", "When enabled applied evolution targets will be moved to the end of queue, instead of being removed");


        currentNode.append(`
          <div style="margin-top: 5px; display: inline-block; width: 90%; text-align: left;">
            <label for="script_evolution_prestige">Prestige for new evolutions:</label>
            <select id="script_evolution_prestige" style="height: 18px; width: 150px; float: right;">
              <option value = "auto" title = "Inherited from current Prestige Settings">Current Prestige</option>
              ${prestigeOptions}
            </select>
          </div>
          <div style="margin-top: 10px;">
            <button id="script_evlution_add" class="button">Add New Evolution</button>
          </div>`);

        $("#script_evlution_add").on("click", addEvolutionSetting);
        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:25%">Race</th>
              <th class="has-text-warning" style="width:70%" title="Settings applied before evolution. Changed settings not limited to initial template, you can manually add any script options to JSON.">Settings</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_evolutionQueueTable"></tbody>
          </table>`);

        let tableBodyNode = $('#script_evolutionQueueTable');
        for (let i = 0; i < settingsRaw.evolutionQueue.length; i++) {
            tableBodyNode.append(buildEvolutionQueueItem(i));
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let newOrder = tableBodyNode.sortable('toArray', {attribute: 'value'});
                settingsRaw.evolutionQueue = newOrder.map((i) => settingsRaw.evolutionQueue[i]);

                updateSettingsFromState();
                updateEvolutionSettingsContent();
            },
        } );

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildEvolutionQueueItem(id) {
        let queuedEvolution = settingsRaw.evolutionQueue[id];

        let raceName = "";
        let raceClass = "";
        let prestigeName = "";
        let prestigeClass = "";

        let race = races[queuedEvolution.userEvolutionTarget];
        let isValdi = queuedEvolution.challenge_junker || race === races.junker;
        let isSludge = queuedEvolution.challenge_sludge || race === races.sludge;

        const getRaceColor = (race) => {
            let suited = race.getHabitability();
            if (suited === 1) {
                return "has-text-info";
            } else if (suited === 0) {
                return "has-text-danger";
            } else {
                return "has-text-warning";
            }
        };

        if (isValdi && isSludge) {
            raceName = "Valdi and Sludge can not be combined!";
            raceClass = "has-text-danger";
        } else if (isValdi || isSludge) {
            raceName = `${isValdi ? races.junker.name : races.sludge.name}, `;
            if (race && race !== races.junker && race !== races.sludge) {
                raceName += game.loc(`genelab_genus_${race.genus}`);
                raceClass = getRaceColor(race);
            } else {
                raceName += game.loc(`genelab_genus_fungi`);
                raceClass = getRaceColor(races.shroomi);
            }
        } else if (queuedEvolution.userEvolutionTarget === "auto") {
            raceName = "Auto Achievements";
            raceClass = "has-text-advanced";
        } else if (race) {
            raceName = race.name;
            raceClass = getRaceColor(race);
        } else {
            raceName = "Unrecognized race!";
            raceClass = "has-text-danger";
        }

        let star = $(`#settings a.dropdown-item:contains("${game.loc(game.global.settings.icon)}") svg`).clone();
        star.removeClass();
        star.addClass("star" + getStarLevel(queuedEvolution));

        if (queuedEvolution.prestigeType !== "none") {
            let prestige = prestigeTypes.find(prest => prest.val === queuedEvolution.prestigeType);
            if (prestige) {
                prestigeName = `(${prestige.short_label ?? prestige.label})`;
                prestigeClass = "has-text-info";
            } else {
                prestigeName = "Unrecognized prestige!";
                prestigeClass = "has-text-danger";
            }
        }

        let queueNode = $(`
          <tr id="script_evolution_${id}" value="${id}" class="script-draggable">
            <td style="width:25%"><span class="${raceClass}">${raceName}</span> <span class="${prestigeClass}">${prestigeName}</span> ${star.prop('outerHTML') ?? (getStarLevel(queuedEvolution)-1) + "*"}</td>
            <td style="width:70%"><textarea class="textarea">${JSON.stringify(queuedEvolution, null, 4)}</textarea></td>
            <td style="width:5%"><a class="button is-dark is-small" style="width: 26px; height: 26px"><span>X</span></a></td>
          </tr>`);

        // Delete button
        queueNode.find(".button").on('click', function() {
            settingsRaw.evolutionQueue.splice(id, 1);
            updateSettingsFromState();
            updateEvolutionSettingsContent();
            resetTabHeight("evolutionSettings");
        });


        // Settings textarea
        queueNode.find(".textarea").on('change', function() {
            try {
                let queuedEvolution = JSON.parse(this.value);
                settingsRaw.evolutionQueue[id] = queuedEvolution;
                updateSettingsFromState();
                updateEvolutionSettingsContent();
            } catch (error) {
                queueNode.find('td:eq(0)').html(`<span class="has-text-danger">${error}</span>`);
            }
            resetTabHeight("evolutionSettings");
        });

        return queueNode;
    }

    function addEvolutionSetting() {
        let queuedEvolution = {};
        for (let i = 0; i < evolutionSettingsToStore.length; i++){
            let settingName = evolutionSettingsToStore[i];
            let settingValue = settingsRaw[settingName];
            queuedEvolution[settingName] = settingValue;
        }

        let overridePrestige = $("#script_evolution_prestige").first().val();
        if (overridePrestige && overridePrestige !== "auto") {
            queuedEvolution.prestigeType = overridePrestige;
        }

        let queueLength = settingsRaw.evolutionQueue.push(queuedEvolution);
        updateSettingsFromState();

        let tableBodyNode = $('#script_evolutionQueueTable');
        tableBodyNode.append(buildEvolutionQueueItem(queueLength-1));

        resetTabHeight("evolutionSettings");
    }

    function buildPlanetSettings() {
        let sectionId = "planet";
        let sectionName = "Planet Weighting";

        let resetFunction = function() {
            resetPlanetSettings(true);
            updateSettingsFromState();
            updatePlanetSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updatePlanetSettingsContent);
    }

    function updatePlanetSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_planetContent');
        currentNode.empty().off("*");

        currentNode.append(`
          <span>Planet Weighting = Biome Weighting + Trait Weighting + (Extras Intensity * Extras Weightings)</span>
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:20%">Biome</th>
              <th class="has-text-warning" style="width:calc(40% / 3)">Weighting</th>
              <th class="has-text-warning" style="width:20%">Trait</th>
              <th class="has-text-warning" style="width:calc(40% / 3)">Weighting</th>
              <th class="has-text-warning" style="width:20%">Extra</th>
              <th class="has-text-warning" style="width:calc(40% / 3)">Weighting</th>
            </tr>
            <tbody id="script_planetTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_planetTableBody');
        let newTableBodyText = "";

        let tableSize = Math.max(biomeList.length, traitList.length, extraList.length);
        for (let i = 0; i < tableSize; i++) {
            newTableBodyText += `<tr><td id="script_planet_${i}" style="width:20%"></td><td style="width:calc(40% / 3);border-right-width:1px"></td><td style="width:20%"></td><td style="width:calc(40% / 3);border-right-width:1px"></td><td style="width:20%"></td><td style="width:calc(40% / 3)"></td>/tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        for (let i = 0; i < tableSize; i++) {
            let tableElement = $('#script_planet_' + i);

            if (i < biomeList.length) {
                tableElement.append(buildTableLabel(game.loc("biome_" +  biomeList[i] + "_name")));
                tableElement = tableElement.next();
                addTableInput(tableElement, "biome_w_" + biomeList[i]);
            } else {
                tableElement = tableElement.next();
            }
            tableElement = tableElement.next();

            if (i < traitList.length) {
                tableElement.append(buildTableLabel(i == 0 ? "None" : game.loc("planet_" + traitList[i])));
                tableElement = tableElement.next();
                addTableInput(tableElement, "trait_w_" + traitList[i]);
            } else {
                tableElement = tableElement.next();
            }
            tableElement = tableElement.next();

            if (i < extraList.length) {
                tableElement.append(buildTableLabel(extraList[i]));
                tableElement = tableElement.next();
                addTableInput(tableElement, "extra_w_" + extraList[i]);
            }
        }

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildTriggerSettings() {
        let sectionId = "trigger";
        let sectionName = "Trigger";

        let resetFunction = function() {
            resetTriggerSettings(true);
            updateSettingsFromState();
            updateTriggerSettingsContent();
            resetTabHeight("triggerSettings");

            resetCheckbox("autoTrigger");
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateTriggerSettingsContent);
    }

    function updateTriggerSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_triggerContent');
        currentNode.empty().off("*");

        currentNode.append('<div style="margin-top: 10px;"><button id="script_trigger_add" class="button">Add New Trigger</button></div>');
        $("#script_trigger_add").on("click", addTriggerSetting);

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" colspan="3">Requirement</th>
              <th class="has-text-warning" colspan="5">Action</th>
            </tr>
            <tr>
              <th class="has-text-warning" style="width:16%">Type</th>
              <th class="has-text-warning" style="width:18%">Id</th>
              <th class="has-text-warning" style="width:11%">Count</th>
              <th class="has-text-warning" style="width:16%">Type</th>
              <th class="has-text-warning" style="width:18%">Id</th>
              <th class="has-text-warning" style="width:11%">Count</th>
              <th style="width:5%"></th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_triggerTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_triggerTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < TriggerManager.priorityList.length; i++) {
            const trigger = TriggerManager.priorityList[i];
            newTableBodyText += `<tr id="script_trigger_${trigger.seq}" value="${trigger.seq}" class="script-draggable"><td style="width:16%"></td><td style="width:18%"></td><td style="width:11%"></td><td style="width:16%"></td><td style="width:18%"></td><td style="width:11%"></td><td style="width:5%"></td><td style="width:5%"><span class="script-lastcolumn"></span></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        for (let i = 0; i < TriggerManager.priorityList.length; i++) {
            const trigger = TriggerManager.priorityList[i];

            buildTriggerRequirementType(trigger);
            buildTriggerRequirementId(trigger);
            buildTriggerRequirementCount(trigger);

            buildTriggerActionType(trigger);
            buildTriggerActionId(trigger);
            buildTriggerActionCount(trigger);

            buildTriggerSettingsColumn(trigger);
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let triggerIds = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < triggerIds.length; i++) {
                    TriggerManager.getTrigger(parseInt(triggerIds[i])).priority = i;
                }

                TriggerManager.sortByPriority();
                updateSettingsFromState();
            },
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function addTriggerSetting() {
        let trigger = TriggerManager.AddTrigger("unlocked", "tech-club", 0, "research", "tech-club", 0);
        updateSettingsFromState();

        let tableBodyNode = $('#script_triggerTableBody');
        let newTableBodyText = "";

        newTableBodyText += `<tr id="script_trigger_${trigger.seq}" value="${trigger.seq}" class="script-draggable"><td style="width:16%"></td><td style="width:18%"></td><td style="width:11%"></td><td style="width:16%"></td><td style="width:18%"></td><td style="width:11%"></td><td style="width:5%"></td><td style="width:5%"><span class="script-lastcolumn"></span></td></tr>`;

        tableBodyNode.append($(newTableBodyText));

        buildTriggerRequirementType(trigger);
        buildTriggerRequirementId(trigger);
        buildTriggerRequirementCount(trigger);

        buildTriggerActionType(trigger);
        buildTriggerActionId(trigger);
        buildTriggerActionCount(trigger);

        buildTriggerSettingsColumn(trigger);
        resetTabHeight("triggerSettings");
    }

    function buildTriggerRequirementType(trigger) {
        let triggerElement = $('#script_trigger_' + trigger.seq).children().eq(0);
        triggerElement.empty().off("*");

        // Requirement Type
        let typeSelectNode = $(`
          <select>
            <option value = "unlocked" title = "This condition is met when technology is shown in research tab">Unlocked</option>
            <option value = "researched" title = "This condition is met when technology is researched">Researched</option>
            <option value = "built" title = "This condition is met when you have 'count' or greater amount of buildings">Built</option>
            <option value = "chain" title = "This condition is met when above trigger is complete, always true for first trigger in list">Chain</option>
          </select>`);
        typeSelectNode.val(trigger.requirementType);

        triggerElement.append(typeSelectNode);

        typeSelectNode.on('change', function() {
            trigger.updateRequirementType(this.value);

            buildTriggerRequirementId(trigger);
            buildTriggerRequirementCount(trigger);

            buildTriggerActionType(trigger);
            buildTriggerActionId(trigger);
            buildTriggerActionCount(trigger);

            updateSettingsFromState();
        });

        return;
    }

    function buildTriggerRequirementId(trigger) {
        let triggerElement = $('#script_trigger_' + trigger.seq).children().eq(1);
        triggerElement.empty().off("*");

        if (trigger.requirementType === "researched" || trigger.requirementType === "unlocked") {
            triggerElement.append(buildTriggerListInput(techIds, trigger, "requirementId"));
        }
        if (trigger.requirementType === "built") {
            triggerElement.append(buildTriggerListInput(buildingIds, trigger, "requirementId"));
        }
    }

    function buildTriggerRequirementCount(trigger) {
        let triggerElement = $('#script_trigger_' + trigger.seq).children().eq(2);
        triggerElement.empty().off("*");

        if (trigger.requirementType === "built") {
            triggerElement.append(buildTriggerCountInput(trigger, "requirementCount"));
        }
    }

    function buildTriggerActionType(trigger) {
        let triggerElement = $('#script_trigger_' + trigger.seq).children().eq(3);
        triggerElement.empty().off("*");

        // Action Type
        let typeSelectNode = $(`
          <select>
            <option value = "research" title = "Research technology">Research</option>
            <option value = "build" title = "Build buildings up to 'count' amount">Build</option>
            <option value = "arpa" title = "Build projects up to 'count' amount">A.R.P.A.</option>
          </select>`);
        typeSelectNode.val(trigger.actionType);

        triggerElement.append(typeSelectNode);

        typeSelectNode.on('change', function() {
            trigger.updateActionType(this.value);

            buildTriggerActionId(trigger);
            buildTriggerActionCount(trigger);

            updateSettingsFromState();
        });

        return;
    }

    function buildTriggerActionId(trigger) {
        let triggerElement = $('#script_trigger_' + trigger.seq).children().eq(4);
        triggerElement.empty().off("*");

        if (trigger.actionType === "research") {
            triggerElement.append(buildTriggerListInput(techIds, trigger, "actionId"));
        }
        if (trigger.actionType === "build") {
            triggerElement.append(buildTriggerListInput(buildingIds, trigger, "actionId"));
        }
        if (trigger.actionType === "arpa") {
            triggerElement.append(buildTriggerListInput(arpaIds, trigger, "actionId"));
        }
    }

    function buildTriggerActionCount(trigger) {
        let triggerElement = $('#script_trigger_' + trigger.seq).children().eq(5);
        triggerElement.empty().off("*");

        if (trigger.actionType === "build" || trigger.actionType === "arpa") {
            triggerElement.append(buildTriggerCountInput(trigger, "actionCount"));
        }
    }

    function buildTriggerSettingsColumn(trigger) {
        let triggerElement = $('#script_trigger_' + trigger.seq).children().eq(6);
        triggerElement.empty().off("*");

        let deleteTriggerButton = $('<a class="button is-dark is-small" style="width: 26px; height: 26px"><span>X</span></a>');
        triggerElement.append(deleteTriggerButton);
        deleteTriggerButton.on('click', function() {
            TriggerManager.RemoveTrigger(trigger.seq);
            updateSettingsFromState();
            updateTriggerSettingsContent();
            resetTabHeight("triggerSettings");
        });
    }

    function buildTriggerListInput(list, trigger, property){
        let typeSelectNode = $('<input style="width:100%"></input>');

        // Event handler
        let onChange = function(event, ui) {
            event.preventDefault();

            // If it wasn't selected from list
            if(ui.item === null){
                let typedName = Object.values(list).find(obj => obj.name === this.value);
                if (typedName !== undefined){
                    ui.item = {label: this.value, value: typedName._vueBinding};
                }
            }

            // We have an item to switch
            if (ui.item !== null && list.hasOwnProperty(ui.item.value)) {
                if (trigger[property] === ui.item.value) {
                    return;
                }

                trigger[property] = ui.item.value;
                trigger.complete = false;

                updateSettingsFromState();

                this.value = ui.item.label;
                return;
            }

            // No building selected, don't change trigger, just restore old name in text field
            if (list.hasOwnProperty(trigger[property])) {
                this.value = list[trigger[property]].name;
                return;
            }
        };

        typeSelectNode.autocomplete({
            minLength: 2,
            delay: 0,
            source: function(request, response) {
                let matcher = new RegExp($.ui.autocomplete.escapeRegex(request.term), "i");
                response(Object.values(list)
                  .filter(item => matcher.test(item.name))
                  .map(item => ({label: item.name, value: item._vueBinding})));
            },
            select: onChange, // Dropdown list click
            focus: onChange, // Arrow keys press
            change: onChange // Keyboard type
        });

        if (list.hasOwnProperty(trigger[property])) {
            typeSelectNode.val(list[trigger[property]].name);
        }

        return typeSelectNode;
    }

    function buildTriggerCountInput(trigger, property) {
        let textBox = $('<input type="text" class="input is-small" style="height: 22px; width:100%"/>');
        textBox.val(trigger[property]);

        textBox.on('change', function() {
            let parsedValue = getRealNumber(textBox.val());
            if (!isNaN(parsedValue)) {
                trigger[property] = parsedValue;
                trigger.complete = false;

                updateSettingsFromState();
            }
            textBox.val(trigger[property]);
        });

        return textBox;
    }

    function buildAdvTriggerSettings() {
        // Main bulk of the UI logic is in AdvTriggerManager.
        // This is just a placeholder to add it into settings.
        let sectionId = "advTrigger";
        let sectionName = "Advanced Trigger";

        let updateFunction = () => {
            let currentNode = $('#script_advTriggerContent');
            currentNode.replaceChildren(AdvTriggerManager.div);
        };

        buildSettingsSection(sectionId, sectionName, () => { }, updateTriggerSettingsContent);
    }

    function buildActiveTargetsUI() {
        if (settingsRaw.activeTargetsUI && !$("#active_targets-wrapper").length) {
            $("#buildQueue").before(`
                <div id="active_targets-wrapper" class="bldQueue vscroll right">
                    <h2 class="has-text-success">Detailed Queue</h2>
                    <div id="active_targets">
                        <div class="target-type-box triggers" style="display: none;">
                            <h2>Triggers</h2>
                            <ul class="active_targets-list triggers"></ul>
                        </div>
                        <div class="target-type-box buildings" style="display: none;">
                            <h2>Buildings</h2>
                            <ul class="active_targets-list buildings"></ul>
                        </div>
                        <div class="target-type-box research" style="display: none;">
                            <h2>Research</h2>
                            <ul class="active_targets-list research"></ul>
                        </div>
                        <div class="target-type-box arpa" style="display: none;">
                            <h2>A.R.P.A.</h2>
                            <ul class="active_targets-list arpa"></ul>
                        </div>
                    </div>
                </div>`);

            // game assumes only message and build queue, and hardcodes heights accordingly. This overrides that to ensure scroll bars are added on message queue when active targets queue crowds it out
            if (typeof ResizeObserver === 'function') {
                const resizeObserver = new ResizeObserver((entries) => {
                    for (const entry of entries) {
                        if (entry.borderBoxSize) {
                            const elementHeight = entry.borderBoxSize[0].blockSize;
                            const totalHeight = `${elementHeight + $(`#buildQueue`).outerHeight()}px`;

                            $("#msgQueue").css('max-height', `calc((100vh - ${totalHeight}) - 6rem)`);
                        }
                    }
                });

                resizeObserver.observe($("#active_targets-wrapper")[0]);
            }
        }
    }

    function removeActiveTargetsUI() {
        $("#active_targets-wrapper").remove();
    }

    function buildResearchSettings() {
        let sectionId = "research";
        let sectionName = "Research";

        let resetFunction = function() {
            resetResearchSettings(true);
            updateSettingsFromState();
            updateResearchSettingsContent();

            resetCheckbox("autoResearch");
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateResearchSettingsContent);
    }

    function updateResearchSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_researchContent');
        currentNode.empty().off("*");

        // Theology 1
        let theology1Options = [{val: "auto", label: "Script Managed", hint: "Picks Anthropology for MAD prestige, and Fanaticism for others. Achieve-worthy combos are exception, on such runs Fanaticism will be always picked."},
                                {val: "tech-anthropology", label: game.loc('tech_anthropology'), hint: game.loc('tech_anthropology_effect')},
                                {val: "tech-fanaticism", label: game.loc('tech_fanaticism'), hint: game.loc('tech_fanaticism_effect')}];
        addSettingsSelect(currentNode, "userResearchTheology_1", "Target Theology 1", "Theology 1 technology to research, have no effect after getting Transcendence perk", theology1Options);

        // Theology 2
        let theology2Options = [{val: "auto", label: "Script Managed", hint: "Picks Deify for Ascension, Demonic Infusion, AI Apocalypse, Terraform, Matrix, Retirement and Eden prestiges, or Study for others prestiges"},
                                {val: "tech-study", label: game.loc('tech_study'), hint: game.loc('tech_study_desc')},
                                {val: "tech-deify", label: game.loc('tech_deify'), hint: game.loc('tech_deify_desc')}];
        addSettingsSelect(currentNode, "userResearchTheology_2", "Target Theology 2", "Theology 2 technology to research", theology2Options);

        addSettingsList(currentNode, "researchIgnore", "Ignored researches", "Listed researches won't be purchased without manual input, or user defined trigger. On top of this list script will also ignore some other special techs, such as Limit Collider, Dark Energy Bomb, Exotic Infusion, etc.", techIds);

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildWarSettings(parentNode, secondaryPrefix) {
        let sectionId = "war";
        let sectionName = "Foreign Affairs";

        let resetFunction = function() {
            resetWarSettings(true);
            updateSettingsFromState();
            updateWarSettingsContent(secondaryPrefix);

            resetCheckbox("autoFight");
        };

        buildSettingsSection2(parentNode, secondaryPrefix, sectionId, sectionName, resetFunction, updateWarSettingsContent);
    }

    function updateWarSettingsContent(secondaryPrefix) {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $(`#script_${secondaryPrefix}warContent`);
        currentNode.empty().off("*");

        addSettingsHeader1(currentNode, "Foreign Powers");
        addSettingsToggle(currentNode, "foreignPacifist", "Pacifist", "Turns attacks off and on");

        addSettingsToggle(currentNode, "foreignUnification", "Perform unification", "Perform unification once all three powers are controlled. autoResearch should be enabled for this to work.");
        addSettingsToggle(currentNode, "foreignOccupyLast", "Occupy last foreign power", "Occupy last foreign power once other two are controlled, and unification is researched to speed up unification. Disable if you want annex\\purchase achievements.");
        addSettingsToggle(currentNode, "foreignForceSabotage", "Sabotage foreign power when useful", "Perform sabotage against current target if it's useful(power above 50), regardless of required power, and default action defined above");
        addSettingsToggle(currentNode, "foreignTrainSpy", "Train spies", "Train spies to use against foreign powers");
        addSettingsToggle(currentNode, "foreignForceOccupy", "Force occupation before unification researched", "Initiate Purchase/Annex/Occupy actions before Unification is available, be careful about setting up Purchase too soon as it may prevent your game progress. Use with overrides.");
        addSettingsNumber(currentNode, "foreignSpyMax", "Maximum spies", "Maximum spies per foreign power");

        addSettingsNumber(currentNode, "foreignPowerRequired", "Military Power to switch target", "Switches to attack next foreign power once its power lowered down to this number. When exact numbers not know script tries to approximate it.");

        let policyOptions = [{val: "Ignore", label: "Ignore", hint: ""},
                             ...Object.entries(SpyManager.Types).map(([name, task]) => (
                             {val: name, label: game.loc("civics_spy_" + task.id), hint: ""})),
                             {val: "Occupy", label: "Occupy", hint: ""}];
        addSettingsSelect(currentNode, "foreignPolicyInferior", "Inferior Power", "Perform this against inferior foreign power, with military power equal or below given threshold. Complex actions includes required preparation - Annex and Purchase will incite and influence, Occupy will sabotage, until said options will be available.", policyOptions);
        addSettingsSelect(currentNode, "foreignPolicySuperior", "Superior Power", "Perform this against superior foreign power, with military power above given threshold. Complex actions includes required preparation - Annex and Purchase will incite and influence, Occupy will sabotage, until said options will be available.", policyOptions);

        let rivalOptions = [{val: "Ignore", label: "Ignore", hint: "Does nothing"},
                            {val: "Influence", label: "Alliance", hint: "Influence rival up to best relations"},
                            {val: "Sabotage", label: "War", hint: "Sabotage and plunder rival"},
                            {val: "Betrayal", label: "Betrayal", hint: "Influence rival up to best relations, and start sabotaging. Once military power reached minimum - start plundering it"}];
        addSettingsSelect(currentNode, "foreignPolicyRival", "Rival Power (The True Path)", "Perform this against rival foreign power.", rivalOptions);

        // Campaign panel
        addSettingsHeader1(currentNode, "Campaigns");
        addSettingsNumber(currentNode, "foreignAttackLivingSoldiersPercent", "Minimum percentage of alive soldiers for attack", "Only attacks if you ALSO have the target battalion size of healthy soldiers available, so this setting will only take effect if your battalion does not include all of your soldiers");
        addSettingsNumber(currentNode, "foreignAttackHealthySoldiersPercent", "Minimum percentage of healthy soldiers for attack", "Set to less than 100 to take advantage of being able to heal more soldiers in a game day than get wounded in a typical attack");
        addSettingsNumber(currentNode, "foreignHireMercMoneyStoragePercent", "Hire mercenary if money storage greater than percent", "Hire a mercenary if remaining money after purchase will be greater than this percent");
        addSettingsNumber(currentNode, "foreignHireMercCostLowerThanIncome", "OR if cost lower than money earned in X seconds", "Combines with the money storage percent setting to determine when to hire mercenaries");
        addSettingsNumber(currentNode, "foreignHireMercDeadSoldiers", "AND amount of dead soldiers above this number", "Hire a mercenary only when current amount of dead soldiers above given number");

        addSettingsNumber(currentNode, "foreignMinAdvantage", "Minimum advantage", "Minimum advantage to launch campaign, ignored during ambushes. 100% chance to win will be reached at approximately(influenced by traits and selected campaign) 75% advantage.");
        addSettingsNumber(currentNode, "foreignMaxAdvantage", "Maximum advantage", "Once campaign is selected, your battalion will be limited in size down to this advantage, reducing potential loses");
        addSettingsNumber(currentNode, "foreignMaxSiegeBattalion", "Maximum siege battalion", "Maximum battalion for siege campaign. Only try to siege if it's possible with up to given amount of soldiers. Siege is expensive, if you'll be doing it with too big battalion it might be less profitable than other combat campaigns. This option does not applied to unifying sieges, it affect only looting.");

        let protectOptions = [{val: "never", label: "Never", hint: "No additional limits to battalion size. Always send maximum soldiers allowed with current Max Advantage."},
                              {val: "always", label: "Always", hint: "Limit battalions to sizes which will neven suffer any casualties in successful fights. You still will lose soldiers after failures, increasing minimum advantage can improve winning odds. This option designed to use with armored races favoring frequent attacks, with no approppriate build it may prevent any attacks from happening."},
                              {val: "auto", label: "Auto", hint: "Tries to maximize total number of attacks, alternating between full and safe attacks based on soldiers condition, to get most from both healing and recruiting."}];
        addSettingsSelect(currentNode, "foreignProtect", "Protect soldiers", "Configures safety of attacks. This option does not applies to unifying sieges, it affect only looting.", protectOptions);

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildHellSettings(parentNode, secondaryPrefix) {
        let sectionId = "hell";
        let sectionName = "Hell";

        let resetFunction = function() {
            resetHellSettings(true);
            updateSettingsFromState();
            updateHellSettingsContent(secondaryPrefix);

            resetCheckbox("autoHell");
        };

        buildSettingsSection2(parentNode, secondaryPrefix, sectionId, sectionName, resetFunction, updateHellSettingsContent);
    }

    function updateHellSettingsContent(secondaryPrefix) {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $(`#script_${secondaryPrefix}hellContent`);
        currentNode.empty().off("*");

        addSettingsHeader1(currentNode, "Entering Hell");
        addSettingsNumber(currentNode, "hellHomeGarrison", "Soldiers to stay out of hell", "Home garrison maximum");
        addSettingsNumber(currentNode, "hellMinSoldiers", "Minimum soldiers to be available for hell (pull out if below)", "Don't enter hell if not enough soldiers, or get out if already in");
        addSettingsNumber(currentNode, "hellMinSoldiersPercent", "Alive soldier percentage for entering hell", "Don't enter hell if too many soldiers are dead, but don't get out");

        addSettingsHeader1(currentNode, "Hell Garrison");
        addSettingsToggle(currentNode, "hellAssaultReserve", "Always reserve hell troops to Secure the Pit", "With this option enabled hell soldiers will be put to fortress once Secure the Pit is unlocked, to fulfil its costs. It makes saving resources and setting triggers for it easier, at cost of less efficient use of manpower.");
        addSettingsNumber(currentNode, "hellTargetFortressDamage", "Target wall damage per siege (overestimates threat)", "Actual damage will usually be lower due to patrols and drones");
        addSettingsNumber(currentNode, "hellLowWallsMulti", "Garrison bolster factor for damaged walls", "Multiplies target defense rating by this when close to 0 wall integrity, half as much increase at half integrity");

        addSettingsHeader1(currentNode, "Patrol Size");
        addSettingsToggle(currentNode, "hellHandlePatrolSize", "Automatically adjust patrol size", "Sets patrol attack rating based on current threat, lowers it depending on buildings, increases it to the minimum rating, and finally increases it based on dead soldiers. Handling patrol count has to be turned on.");
        addSettingsNumber(currentNode, "hellPatrolMinRating", "Minimum patrol attack rating", "Will never go below this");
        addSettingsNumber(currentNode, "hellPatrolThreatPercent", "Percent of current threat as base patrol rating", "Demon encounters have a rating of 2 to 10 percent of current threat");
        addSettingsNumber(currentNode, "hellPatrolDroneMod", "&emsp;Lower Rating for each active Predator Drone by", "Predators reduce threat before patrols fight");
        addSettingsNumber(currentNode, "hellPatrolDroidMod", "&emsp;Lower Rating for each active War Droid by", "War Droids boost patrol attack rating by 1 or 2 soldiers depending on tech");
        addSettingsNumber(currentNode, "hellPatrolBootcampMod", "&emsp;Lower Rating for each Bootcamp by", "Bootcamps help regenerate soldiers faster");
        addSettingsNumber(currentNode, "hellBolsterPatrolRating", "Increase patrol rating by up to this when soldiers die", "Larger patrols are less effective, but also have fewer deaths");
        addSettingsNumber(currentNode, "hellBolsterPatrolPercentTop", "&emsp;Start increasing patrol rating at this home garrison fill percent", "This is the higher number");
        addSettingsNumber(currentNode, "hellBolsterPatrolPercentBottom", "&emsp;Full patrol rating increase below this home garrison fill percent", "This is the lower number");

        // Attractors
        addSettingsHeader1(currentNode, "Attractors");
        addSettingsNumber(currentNode, "hellAttractorBottomThreat", "&emsp;All Attractors on below this threat", "Turn more and more attractors off when getting nearer to the top threat. Auto Power needs to be on for this to work.");
        addSettingsNumber(currentNode, "hellAttractorTopThreat", "&emsp;All Attractors off above this threat", "Turn more and more attractors off when getting nearer to the top threat. Auto Power needs to be on for this to work.");

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildFleetSettings(parentNode, secondaryPrefix) {
        let sectionId = "fleet";
        let sectionName = "Fleet";

        let resetFunction = function() {
            resetFleetSettings(true);
            updateSettingsFromState();
            updateFleetSettingsContent(secondaryPrefix);

            resetCheckbox("autoFleet");
        };

        buildSettingsSection2(parentNode, secondaryPrefix, sectionId, sectionName, resetFunction, updateFleetSettingsContent);
    }

    function updateFleetSettingsContent(secondaryPrefix) {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $(`#script_${secondaryPrefix}fleetContent`);
        currentNode.empty().off("*");

        updateFleetAndromeda(currentNode, secondaryPrefix);
        updateFleetOuter(currentNode, secondaryPrefix);

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function updateFleetOuter(currentNode, secondaryPrefix) {
        addStandardHeading(currentNode, "Outer Solar");

        let shipOptions = [{val: "none", label: "None", hint: "Ship building disabled"},
                           {val: "user", label: "Current design", hint: "Build whatever currently set in Ship Yard"},
                           {val: "manual", label: "Manual mode", hint: "Assists accumulating resources needed for current blueprint, without building or deploying anything. It also might need tweaking prioritization settings to work."},
                           {val: "custom", label: "Presets", hint: "Build ships with components configured below. All components need to be unlocked, and resulting design should have enough power"}];
        addSettingsSelect(currentNode, "fleetOuterShips", "Ships to build", "Once avalable and affordable script will build ship of selected design, and send it to region with most piracy * weighting", shipOptions);
        addSettingsNumber(currentNode, "fleetOuterCrew", "Minimum idle soldiers", "Only build ships when amount of idle soldiers above give number");
        addSettingsToggle(currentNode, "fleetExploreTau", "Explore Tau Ceti", "Send explorer to Tau Ceti");

        addSettingsHeader1(currentNode, "Fighter");
        for (let [type, parts] of Object.entries(FleetManagerOuter.ShipConfig)) {
            let partOptions = parts.map(id => ({val: id, label: game.loc(`outer_shipyard_${type}_${id}`)}));
            addSettingsSelect(currentNode, `fleet_outer_${type}`, game.loc(`outer_shipyard_${type}`), "Preset ship component", partOptions);
        }
        addSettingsHeader1(currentNode, "Scout");
        for (let [type, parts] of Object.entries(FleetManagerOuter.ShipConfig)) {
            let partOptions = parts.map(id => ({val: id, label: game.loc(`outer_shipyard_${type}_${id}`)}));
            addSettingsSelect(currentNode, `fleet_scout_${type}`, game.loc(`outer_shipyard_${type}`), "Preset ship component", partOptions);
        }

        currentNode.append(`
          <table style="width:100%; text-align: left">
            <tr>
              <th class="has-text-warning" style="width:35%">Region</th>
              <th class="has-text-warning" style="width:20%" title="Weighting determines order of ships dispatching, regions with higher weighting will be get ships sooner">Weighting</th>
              <th class="has-text-warning" style="width:20%" title="Desired protection from syndicate, trying to reach 100%(1.0) defense with full uptime might be wasteful due to excesses and fluctuations">Defend</th>
              <th class="has-text-warning" style="width:20%" title="Amounts of scouts to dispatch">Scouts</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_${secondaryPrefix}fleetOuterTable"></tbody>
          </table>`);

        let tableBodyNode = $(`#script_${secondaryPrefix}fleetOuterTable`);
        let newTableBodyText = "";

        for (let reg of FleetManagerOuter.Regions) {
            newTableBodyText += `<tr><td id="script_${secondaryPrefix}fleet_${reg}" style="width:35%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:5%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other productions settings rows
        for (let reg of FleetManagerOuter.Regions) {
            let fleetElement = $(`#script_${secondaryPrefix}fleet_${reg}`);

            let nameRef = game.actions.space[reg].info.name;
            let gameName = typeof nameRef === 'function' ? nameRef() : nameRef;
            let label = reg.split("_").slice(1)
              .map(n => n.charAt(0).toUpperCase() + n.slice(1)).join(" ");
            if (label !== gameName) {
                label += ` (${gameName})`;
            }

            fleetElement.append(buildTableLabel(label));

            fleetElement = fleetElement.next();
            addTableInput(fleetElement, "fleet_outer_pr_" + reg);

            fleetElement = fleetElement.next();
            addTableInput(fleetElement, "fleet_outer_def_" + reg);

            fleetElement = fleetElement.next();
            addTableInput(fleetElement, "fleet_outer_sc_" + reg);
        }
    }

    function updateFleetAndromeda(currentNode, secondaryPrefix) {
        addStandardHeading(currentNode, "Andromeda");
        addSettingsToggle(currentNode, "fleetMaxCover", "Maximize protection of prioritized systems", "Adjusts ships distribution to fully supress piracy in prioritized regions. Some potential defense will be wasted, as it will use big ships to cover small holes, when it doesn't have anything fitting better. This option is not required: all your dreadnoughts still will be used even without this option.");
        addSettingsNumber(currentNode, "fleetEmbassyKnowledge", "Minimum knowledge for Embassy", "Building Embassy increases maximum piracy up to 100, script won't Auto Build it until this knowledge cap is reached.");
        addSettingsNumber(currentNode, "fleetAlienGiftKnowledge", "Minimum knowledge for Alien Gift", "Researching Alien Gift increases maximum piracy up to 250, script won't Auto Research it until this knowledge cap is reached.");
        addSettingsNumber(currentNode, "fleetAlien2Knowledge", "Minimum knowledge for Alien 2 Assault", "Assaulting Alien 2 increases maximum piracy up to 500, script won't do it until this knowledge cap is reached. Regardless of set value it won't ever try to assault until you have big enough fleet to do it without loses.");

        let alien2AssaultOptions = [{val: "none", label: "No Losses", hint: "Min fleet strength 650. No losses."},
                              {val: "suicide", label: "Suicide Mission", hint: "Attack as soon as we hit 400 fleet rating. There will be losses."}];
        addSettingsSelect(currentNode, "fleetAlien2Loses", "Alien 2 Mission", "Assault Alien 2 when chosen outcome is achievable. You should really keep the default, unless you're speed running and want to take it out ASAP with losses.", alien2AssaultOptions);

        let assaultOptions = [{val: "ignore", label: "Manual assault", hint: "Won't ever launch assault mission on Chthonian"},
                              {val: "high", label: "High casualties", hint: "Unlock Chthonian using mixed fleet, high casualties (1250+ total fleet power, 500 will be lost)"},
                              {val: "avg", label: "Average casualties", hint: "Unlock Chthonian using mixed fleet, average casualties (2500+ total fleet power, 160 will be lost)"},
                              {val: "low", label: "Low casualties", hint: "Unlock Chthonian using mixed fleet, low casualties (4500+ total fleet power, 80 will be lost)"},
                              {val: "frigate", label: "Frigate", hint: "Unlock Chthonian loosing Frigate ship(s) (4500+ total fleet power, suboptimal for banana\\instinct runs)"},
                              {val: "dread", label: "Dreadnought", hint: "Unlock Chthonian with Dreadnought suicide mission"}];
        addSettingsSelect(currentNode, "fleetChthonianLoses", "Chthonian Mission", "Assault Chthonian when chosen outcome is achievable. Mixed fleet formed to clear mission with minimum possible wasted ships, e.g. for low causlities it can sacriface 8 scouts, or 2 corvettes and 2 scouts, or frigate, and such. Whatever will be first available. It also takes in account perks and challenges, adjusting fleet accordingly.", assaultOptions);

        currentNode.append(`
          <table style="width:100%; text-align: left">
            <tr>
              <th class="has-text-warning" style="width:95%">Region</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_${secondaryPrefix}fleetTableBody"></tbody>
          </table>`);

        let tableBodyNode = $(`#script_${secondaryPrefix}fleetTableBody`);
        let newTableBodyText = "";

        let priorityRegions = galaxyRegions.slice().sort((a, b) => settingsRaw["fleet_pr_" + a] - settingsRaw["fleet_pr_" + b]);
        for (let i = 0; i < priorityRegions.length; i++) {
            newTableBodyText += `<tr value="${priorityRegions[i]}" class="script-draggable"><td id="script_${secondaryPrefix}fleet_${priorityRegions[i]}" style="width:95%"><td style="width:5%"><span class="script-lastcolumn"></span></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other productions settings rows
        for (let i = 0; i < galaxyRegions.length; i++) {
            let fleetElement = $(`#script_${secondaryPrefix}fleet_${galaxyRegions[i]}`);
            let nameRef = galaxyRegions[i] === "gxy_alien1" ? "Alien 1 System"
                        : galaxyRegions[i] === "gxy_alien2" ? "Alien 2 System"
                        : game.actions.galaxy[galaxyRegions[i]].info.name;

            fleetElement.append(buildTableLabel(typeof nameRef === "function" ? nameRef() : nameRef));
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let regionIds = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < regionIds.length; i++) {
                    settingsRaw["fleet_pr_" + regionIds[i]] = i;
                }

                updateSettingsFromState();
                if (settings.showSettings && secondaryPrefix) {
                    updateFleetSettingsContent('');
                }
            },
        });
    }

    function buildMechSettings() {
        let sectionId = "mech";
        let sectionName = "Mech & Spire";

        let resetFunction = function() {
            resetMechSettings(true);
            updateSettingsFromState();
            updateMechSettingsContent();

            resetCheckbox("autoMech");
            removeMechInfo();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateMechSettingsContent);
    }

    function updateMechSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_mechContent');
        currentNode.empty().off("*");

        let scrapOptions = [{val: "none", label: "None", hint: "Nothing will be scrapped automatically"},
                            {val: "single", label: "Full bay", hint: "Scrap mechs only when mech bay is full, and script need more room to build mechs"},
                            {val: "all", label: "All inefficient", hint: "Scrap all inefficient mechs immediately, using refounded resources to build better ones"},
                            {val: "mixed", label: "Excess inefficient", hint: "Scrap as much inefficient mechs as possible, trying to preserve just enough of old mechs to fill bay to max by the time when next floor will be reached, calculating threshold based on progress speed and resources incomes"}];
        addSettingsSelect(currentNode, "mechScrap", "Scrap mechs", "Configures what will be scrapped. Infernal mechs won't ever be scrapped.", scrapOptions);
        addSettingsNumber(currentNode, "mechScrapEfficiency", "Scrap efficiency", "Scrap mechs only when '((OldMechRefund / NewMechCost) / (OldMechDamage / NewMechDamage))' more than given number.&#xA;For the cases when exchanged mechs have same size(1/3 refund) it means that with 1 eff. script allowed to scrap mechs under 33.3%. 1.5 eff. - under 22.2%, 2 eff. - under 16.6%, 0.5 eff. - under 66.6%, 0 eff. - under 100%, etc.&#xA;Efficiency below '1' is not recommended, unless scrap set to 'Full bay', as it's a breakpoint when refunded resources can immidiately compensate lost damage, resulting with best damage growth rate.&#xA;Efficiency above '1' is useful to save resources for more desperate times, or to compensate low soul gems income.");
        addSettingsNumber(currentNode, "mechCollectorValue", "Collector value", "Collectors can't be directly compared with combat mechs, having no firepower. Script will assume that one collector/size is equal to this amount of scout/size. If you feel that script is too reluctant to scrap old collectors - you can decrease this value. Or increase, to make them more persistant. 1 value - 50% collector equial to 50% scout, 0.5 value - 50% collector equial to 25% scout, 2 value - 50% collector equial to 100% scout, etc.");

        let buildOptions = [{val: "none", label: "None", hint: "Nothing will be build automatically"},
                            {val: "random", label: "Random good", hint: "Build random mech with size chosen below, and best possible efficiency"},
                            {val: "user", label: "Current design", hint: "Build whatever currently set in Mech Lab"}];
        addSettingsSelect(currentNode, "mechBuild", "Build mechs", "Configures what will be built. Infernal mechs won't ever be built.", buildOptions);

        // TODO: Make auto truly auto - some way to pick best "per x", depends on current bottleneck
        let sizeOptions = [{val: "auto", label: "Damage Per Size", hint: "Select affordable mech with most damage per size on current floor"},
                           {val: "gems", label: "Damage Per Gems", hint: "Select affordable mech with most damage per gems on current floor"},
                           {val: "supply", label: "Damage Per Supply", hint: "Select affordable mech with most damage per supply on current floor"},
                            ...MechManager.Size.map(id => ({val: id, label: game.loc(`portal_mech_size_${id}`), hint: game.loc(`portal_mech_size_${id}_desc`)}))];
        addSettingsSelect(currentNode, "mechSize", "Preferred mech size", "Size of random mechs", sizeOptions);
        addSettingsSelect(currentNode, "mechSizeGravity", "Gravity mech size", "Override preferred size with this on floors with high gravity", sizeOptions);

        let specialOptions = [{val: "always", label: "Always", hint: "Add special equipment to all mechs"},
                              {val: "prefered", label: "Preferred", hint: "Add special equipment when it doesn't reduce efficiency for current floor"},
                              {val: "random", label: "Random", hint: "Special equipment will have same chance to be added as all others"},
                              {val: "never", label: "Never", hint: "Never add special equipment"}];
        addSettingsSelect(currentNode, "mechSpecial", "Special mechs", "Configures special equip", specialOptions);
        addSettingsNumber(currentNode, "mechWaygatePotential", "Maximum mech potential for Waygate", "Fight Demon Lord only when current mech team potential below given amount. Full bay of best mechs will have `1` potential. Damage against Demon Lord does not affected by floor modifiers, all mechs always does 100% damage to him. Thus it's most time-efficient to fight him at times when mechs can't make good progress against regular monsters, and waiting for rebuilding. Auto Power needs to be on for this to work.");
        addSettingsNumber(currentNode, "mechMinSupply", "Minimum supply income", "Build collectors if current supply income below given number");
        addSettingsNumber(currentNode, "mechMaxCollectors", "Maximum collectors ratio", "Limiter for above option, maximum space used by collectors. 0.5 means up to 50% of total bay capacity will be dedicated to collectors, and such.");
        addSettingsNumber(currentNode, "mechSaveSupplyRatio", "Save up supplies for next floor", "Ratio of supplies to save up for next floor. Script will stop spending supplies on new mechs when it estimates that by the time when floor will be cleared you'll be under this supply ratio. That allows build bunch of new mechs suited for next enemy right after entering new floor. With 1 value script will try to start new floors with full supplies, 0.5 - with half, 0 - any, effectively disabling this option, etc.");
        addSettingsNumber(currentNode, "mechScouts", "Minimum scouts ratio", "Scouts compensate terrain penalty of suboptimal mechs. Build them up to this ratio.");
        addSettingsToggle(currentNode, "mechInfernalCollector", "Build infernal collectors", "Infernal collectors have incresed supply cost, and payback time, but becomes more profitable after ~30 minutes of uptime.");
        addSettingsToggle(currentNode, "mechScoutsRebuild", "Rebuild scouts", "Scouts provides full bonus to other mechs even being infficient, this option prevent rebuilding them saving resources.");
        addSettingsToggle(currentNode, "mechFillBay", "Build smaller mechs when preferred not available", "Build smaller mechs when preferred size can't be used due to low remaining bay space, or supplies cap");
        addSettingsToggle(currentNode, "buildingMechsFirst", "Build spire buildings only with full bay", "Fill mech bays up to current limit before spending resources on additional spire buildings");
        addSettingsToggle(currentNode, "mechBaysFirst", "Scrap mechs only after building maximum bays", "Scrap old mechs only when no new bays and purifiers can be builded");

        addStandardHeading(currentNode, "Mech Stats");
        let statsControls = $(`<div style="margin-top: 5px; display: inline-flex;"></div>`);
        Object.entries({Compact: true, Efficient: true, Special: true, Gravity: false}).forEach(([option, value]) => {
            statsControls.append(`
              <label class="switch" title="This switch have no ingame effect, and used to configure calculator below">
                <input id="script_mechStats${option}" type="checkbox"${value ? " checked" : ""}>
                <span class="check"></span><span style="margin-left: 10px;">${option}</span>
              </label>`);
        });
        statsControls.append(`
          <label class="switch" title="This input have no ingame effect, and used to configure calculator below">
            <input id="script_mechStatsScouts" class="input is-small" style="height: 25px; width: 50px" type="text" value="0">
            <span style="margin-left: 10px;">Scouts</span>
          </label>`);
        statsControls.on('input', calculateMechStats);
        currentNode.append(statsControls);
        currentNode.append(`<table class="selectable"><tbody id="script_mechStatsTable"><tbody></table>`);
        calculateMechStats();

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function calculateMechStats() {
        let cellInfo = '<td><span class="has-text-info">';
        let cellWarn = '<td><span class="has-text-warning">';
        let cellAdv = '<td><span class="has-text-advanced">';
        let cellEnd = '</span></td>';
        let content = "";

        let special = document.getElementById('script_mechStatsSpecial').checked;
        let gravity = document.getElementById('script_mechStatsGravity').checked;
        let efficient = document.getElementById('script_mechStatsEfficient').checked;
        let scouts = parseInt(document.getElementById("script_mechStatsScouts").value) || 0;
        let prepared = document.getElementById('script_mechStatsCompact').checked ? 2 : 0;

        let smallFactor = efficient ? 1 : average(Object.values(MechManager.SmallChassisMod).reduce((list, mod) => list.concat(Object.values(mod)), []));
        let largeFactor = efficient ? 1 : average(Object.values(MechManager.LargeChassisMod).reduce((list, mod) => list.concat(Object.values(mod)), []));
        let weaponFactor = efficient ? 1 : average(Object.values(poly.monsters).reduce((list, mod) => list.concat(Object.values(mod.weapon)), []));

        let rows = [[""], ["Damage Per Size"], ["Damage Per Supply (New)"], ["Damage Per Gems (New)"], ["Damage Per Supply (Rebuild)"], ["Damage Per Gems (Rebuild)"]];
        for (let i = 0; i < MechManager.Size.length - 1; i++) { // Exclude collectors
            let mech = {size: MechManager.Size[i], equip: special ? ['special'] : []};

            let basePower = MechManager.getSizeMod(mech, false);
            let statusMod = gravity ? MechManager.StatusMod.gravity(mech) : 1;
            let terrainMod = poly.terrainRating(mech, i < 2 ? smallFactor : largeFactor, gravity ? ['gravity'] : [], scouts);
            let weaponMod = poly.weaponPower(mech, weaponFactor) * MechManager.SizeWeapons[mech.size];
            let power = basePower * statusMod * terrainMod * weaponMod;

            let [gems, cost, space] = MechManager.getMechCost(mech, prepared);
            let [gemsRef, costRef] = MechManager.getMechRefund(mech, prepared);

            rows[0].push(game.loc("portal_mech_size_" + mech.size));
            rows[1].push((power / space * 100).toFixed(4));
            rows[2].push((power / (cost / 100000) * 100).toFixed(4));
            rows[3].push((power / gems * 100).toFixed(4));
            rows[4].push((power / ((cost - costRef) / 100000) * 100).toFixed(4));
            rows[5].push((power / (gems - gemsRef) * 100).toFixed(4));
        }
        rows.forEach((line, index) => content += "<tr>" + (index === 0 ? cellWarn : cellAdv) + line.join("&nbsp;" + cellEnd + (index === 0 ? cellAdv : cellInfo)) + cellEnd + "</tr>");
        $("#script_mechStatsTable").html(content);
    }

    function buildEjectorSettings() {
        let sectionId = "ejector";
        let sectionName = "Ejector, Supply & Nanite";

        let resetFunction = function() {
            resetEjectorSettings(true);
            updateSettingsFromState();
            updateEjectorSettingsContent();

            resetCheckbox("autoEject", "autoSupply", "autoNanite");
            removeEjectToggles();
            removeSupplyToggles();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateEjectorSettingsContent);
    }

    function updateEjectorSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_ejectorContent');
        currentNode.empty().off("*");

        let spendOptions = [{val: "cap", label: "Capped", hint: "Use capped resources"},
                            {val: "excess", label: "Excess", hint: "Use excess resources"},
                            {val: "all", label: "All", hint: "Use all resources. This option can prevent script from progressing, and intended to use with additional conditions."},
                            {val: "mixed", label: "Capped > Excess", hint: "Use capped resources first, switching to excess resources when capped alone is not enough."},
                            {val: "full", label: "Capped > Excess > All", hint: "Use capped first, then excess, then everything else. Same as 'All' option can be potentialy dungerous."}];
        let spendDesc = "Configures threshold when script will be allowed to use resources. With any option script will try to use most expensive of allowed resources within selected group. Craftables, when enabled, always use excess amount as threshold, having no cap.";
        addSettingsSelect(currentNode, "ejectMode", "Eject mode", spendDesc, spendOptions);
        addSettingsSelect(currentNode, "supplyMode", "Supply mode", spendDesc, spendOptions);
        addSettingsSelect(currentNode, "naniteMode", "Nanite mode", spendDesc, spendOptions);
        addSettingsToggle(currentNode, "prestigeWhiteholeStabiliseMass", "Stabilize blackhole", "Stabilizes the blackhole with exotic materials, disabled on whitehole runs");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:20%">Resource</th>
              <th class="has-text-warning" style="width:20%">Atomic Mass</th>
              <th class="has-text-warning" style="width:10%">Eject</th>
              <th class="has-text-warning" style="width:10%">Nanite</th>
              <th class="has-text-warning" style="width:30%">Supply Value</th>
              <th class="has-text-warning" style="width:10%">Supply</th>
            </tr>
            <tbody id="script_ejectorTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_ejectorTableBody');
        let newTableBodyText = "";

        let tabResources = [];
        for (let id in resources) {
            let resource = resources[id];
            if (EjectManager.isConsumable(resource) || SupplyManager.isConsumable(resource) || NaniteManager.isConsumable(resource)) {
                tabResources.push(resource);
                newTableBodyText += `<tr><td id="script_eject_${resource.id}" style="width:20%"></td><td style="width:20%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:30%"></td><td style="width:10%"></td></tr>`;
            }
        }

        tableBodyNode.append($(newTableBodyText));

        for (let i = 0; i < tabResources.length; i++) {
            let resource = tabResources[i];
            let ejectElement = $('#script_eject_' + resource.id);

            let color = (resource === resources.Elerium || resource === resources.Infernite) ? "has-text-caution" :
                resource.isCraftable() ? "has-text-danger" :
                !resource.is.tradable ? "has-text-advanced" :
                "has-text-info";

            ejectElement.append(buildTableLabel(resource.name, "", color));
            ejectElement = ejectElement.next();

            if (resource.atomicMass > 0) {
                ejectElement.append(`<span class="mass"><span class="has-text-warning">${resource.atomicMass}</span> kt</span>`);
            }
            ejectElement = ejectElement.next();

            if (EjectManager.isConsumable(resource)) {
                addTableToggle(ejectElement, "res_eject" + resource.id);
            }
            ejectElement = ejectElement.next();

            if (NaniteManager.isConsumable(resource)) {
                addTableToggle(ejectElement, "res_nanite" + resource.id);
            }

            if (SupplyManager.isConsumable(resource)) {
                ejectElement = ejectElement.next();
                ejectElement.append(`<span class="mass">Export <span class="has-text-caution">${SupplyManager.supplyOut(resource.id)}</span>, Gain <span class="has-text-success">${SupplyManager.supplyIn(resource.id)}</span></span>`);

                ejectElement = ejectElement.next();
                addTableToggle(ejectElement, "res_supply" + resource.id);
            }
        }

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildMarketSettings() {
        let sectionId = "market";
        let sectionName = "Market";

        let resetFunction = function() {
            resetMarketSettings(true);
            updateSettingsFromState();
            updateMarketSettingsContent();

            resetCheckbox("autoMarket", "autoGalaxyMarket");
            removeMarketToggles();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateMarketSettingsContent);
    }

    function updateMarketSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_marketContent');
        currentNode.empty().off("*");

        addSettingsNumber(currentNode, "minimumMoney", "Manual trade minimum money", "Minimum money to keep after bulk buying");
        addSettingsNumber(currentNode, "minimumMoneyPercentage", "Manual trade minimum money percentage", "Minimum percentage of money to keep after bulk buying");
        addSettingsNumber(currentNode, "tradeRouteMinimumMoneyPerSecond", "Trade minimum money /s", "Uses the highest per second amount of these two values. Will trade for resources until this minimum money per second amount is hit");
        addSettingsNumber(currentNode, "tradeRouteMinimumMoneyPercentage", "Trade minimum money percentage /s", "Uses the highest per second amount of these two values. Will trade for resources until this percentage of your money per second amount is hit");
        addSettingsToggle(currentNode, "tradeRouteSellExcess", "Sell excess resources", "With this option enabled script will be allowed to sell resources above amounts needed for constructions or researches, without it script sell only capped resources. As side effect boughts will also be limited to that amounts, to avoid 'buy up to cap -> sell excess' loops.");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" colspan="1"></th>
              <th class="has-text-warning" colspan="4">Manual Trades</th>
              <th class="has-text-warning" colspan="4">Trade Routes</th>
              <th class="has-text-warning" colspan="1"></th>
            </tr>
            <tr>
              <th class="has-text-warning" style="width:15%">Resource</th>
              <th class="has-text-warning" style="width:10%">Buy</th>
              <th class="has-text-warning" style="width:10%">Ratio</th>
              <th class="has-text-warning" style="width:10%">Sell</th>
              <th class="has-text-warning" style="width:10%">Ratio</th>
              <th class="has-text-warning" style="width:10%">In</th>
              <th class="has-text-warning" style="width:10%">Away</th>
              <th class="has-text-warning" style="width:10%">Weighting</th>
              <th class="has-text-warning" style="width:10%">Priority</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_marketTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_marketTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < MarketManager.priorityList.length; i++) {
            const resource = MarketManager.priorityList[i];
            newTableBodyText += `<tr value="${resource.id}" class="script-draggable"><td id="script_market_${resource.id}" style="width:15%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%;border-right-width:1px"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:5%"><span class="script-lastcolumn"></span></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other markets settings rows
        for (let i = 0; i < MarketManager.priorityList.length; i++) {
            const resource = MarketManager.priorityList[i];
            let marketElement = $('#script_market_' + resource.id);

            marketElement.append(buildTableLabel(resource.name));

            marketElement = marketElement.next();
            addTableToggle(marketElement, "buy" + resource.id);

            marketElement = marketElement.next();
            addTableInput(marketElement, "res_buy_r_" + resource.id);

            marketElement = marketElement.next();
            addTableToggle(marketElement, "sell" + resource.id);

            marketElement = marketElement.next();
            addTableInput(marketElement, "res_sell_r_" + resource.id);

            marketElement = marketElement.next();
            addTableToggle(marketElement, "res_trade_buy_" + resource.id);

            marketElement = marketElement.next();
            addTableToggle(marketElement, "res_trade_sell_" + resource.id);

            marketElement = marketElement.next();
            addTableInput(marketElement, "res_trade_w_" + resource.id);

            marketElement = marketElement.next();
            addTableInput(marketElement, "res_trade_p_" + resource.id);
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let marketIds = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < marketIds.length; i++) {
                    settingsRaw["res_buy_p_" + marketIds[i]] = i;
                }

                MarketManager.sortByPriority();
                updateSettingsFromState();
            },
        });

        addStandardHeading(currentNode, "Galaxy Trades");
        addSettingsNumber(currentNode, "marketMinIngredients", "Minimum materials to preserve", "Galaxy Market will buy resources only when all selling materials above given ratio");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:30%">Buy</th>
              <th class="has-text-warning" style="width:30%">Sell</th>
              <th class="has-text-warning" style="width:20%">Weighting</th>
              <th class="has-text-warning" style="width:20%">Priority</th>
            </tr>
            <tbody id="script_marketGalaxyTableBody"></tbody>
          </table>`);

        tableBodyNode = $('#script_marketGalaxyTableBody');
        newTableBodyText = "";

        for (let i = 0; i < poly.galaxyOffers.length; i++) {
            newTableBodyText += `<tr><td id="script_market_galaxy_${i}" style="width:30%"><td style="width:30%"></td></td><td style="width:20%"></td><td style="width:20%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other productions settings rows
        for (let i = 0; i < poly.galaxyOffers.length; i++) {
            let trade = poly.galaxyOffers[i];
            let buyResource = resources[trade.buy.res];
            let sellResource = resources[trade.sell.res];
            let marketElement = $('#script_market_galaxy_' + i);

            marketElement.append(buildTableLabel(buyResource.name, "has-text-success"));

            marketElement = marketElement.next();
            marketElement.append(buildTableLabel(sellResource.name, "has-text-danger"));

            marketElement = marketElement.next();
            addTableInput(marketElement, "res_galaxy_w_" + buyResource.id);

            marketElement = marketElement.next();
            addTableInput(marketElement, "res_galaxy_p_" + buyResource.id);
       }

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildStorageSettings() {
        let sectionId = "storage";
        let sectionName = "Storage";

        let resetFunction = function() {
            resetStorageSettings(true);
            updateSettingsFromState();
            updateStorageSettingsContent();

            resetCheckbox("autoStorage");
            removeStorageToggles();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateStorageSettingsContent);
    }

    function updateStorageSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_storageContent');
        currentNode.empty().off("*");

        addSettingsToggle(currentNode, "storageLimitPreMad", "Limit Pre-MAD Storage", "Saves resources and shortens run time by limiting storage pre-MAD");
        addSettingsToggle(currentNode, "storageSafeReassign", "Reassign only empty storages", "Wait until storage is empty before reassigning containers to another resource, to prevent overflowing and wasting resources");
        addSettingsToggle(currentNode, "storageAssignExtra", "Assign buffer storage", "Assigns 3% extra strorage above required amounts, ensuring that required quantity will be actually reached, even if other part of script trying to sell\\eject\\switch production, etc. When manual trades enabled applies additional adjust derieved from selling threshold.");
        addSettingsToggle(currentNode, "storageAssignPart", "Assign partial storage", "When enabled script will be allowed to assign some crates and containers even if resulting storage space won't be enough to build new building. It allows to pre-build stock of resources for further use, but can be potentially dungerous.\nIf script not allowed to reassign non-empty storage it can lock storage in position when stored resources can't be used.\nIf script is allowed to reassign non-empty storage it might waste time producing materials which might need to be disposed.");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:35%">Resource</th>
              <th class="has-text-warning" style="width:15%">Enabled</th>
              <th class="has-text-warning" style="width:15%">Store Overflow</th>
              <th class="has-text-warning" style="width:15%">Min Storage</th>
              <th class="has-text-warning" style="width:15%">Max Storage</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_storageTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_storageTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < StorageManager.priorityList.length; i++) {
            const resource = StorageManager.priorityList[i];
            newTableBodyText += `<tr value="${resource.id}" class="script-draggable"><td id="script_storage_${resource.id}" style="width:35%"></td><td style="width:15%"></td><td style="width:15%"></td><td style="width:15%"></td><td style="width:15%"></td><td style="width:5%"><span class="script-lastcolumn"></span></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other storages settings rows
        for (let i = 0; i < StorageManager.priorityList.length; i++) {
            const resource = StorageManager.priorityList[i];
            let storageElement = $('#script_storage_' + resource.id);

            storageElement.append(buildTableLabel(resource.name));

            storageElement = storageElement.next();
            addTableToggle(storageElement, "res_storage" + resource.id);

            storageElement = storageElement.next();
            addTableToggle(storageElement, "res_storage_o_" + resource.id);

            storageElement = storageElement.next();
            addTableInput(storageElement, "res_min_store" + resource.id);

            storageElement = storageElement.next();
            addTableInput(storageElement, "res_max_store" + resource.id);
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let storageIds = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < storageIds.length; i++) {
                    settingsRaw['res_storage_p_' + storageIds[i]] = i;
                }

                StorageManager.sortByPriority();
                updateSettingsFromState();
            },
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildTraitSettings() {
        let sectionId = "trait";
        let sectionName = "Traits";

        let resetFunction = function() {
            resetMinorTraitSettings(true);
            resetMutableTraitSettings(true);
            updateSettingsFromState();
            updateTraitSettingsContent();

            resetCheckbox("autoMinorTrait", "autoMutateTraits", "autoGenetics");
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateTraitSettingsContent);
    }

    function updateImitateWarning() {
        let race = races[settingsRaw.imitateRace];

        if (race) {
            const raceAvaialableForImitate = race && game.global.stats.synth[race.id];
            if (raceAvaialableForImitate) {
                $("#script_imitate_warning").html(`<span class="has-text-success">You have completed an AI Apocalypse with this race and can imitate it.</span>`);
            } else {
                $("#script_imitate_warning").html(`<span class="has-text-danger">Warning! You have NOT completed an AI Apocalypse with this race, and cannot imitate it.</span>`);
            }
        } else {
            $("#script_imitate_warning").empty();
        }
    }

    function updateTraitSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_traitContent');

        currentNode.empty().off("*");

        addStandardHeading(currentNode, "Major Traits");
        let genusOptions = [{val: "ignore", label: "Ignore", hint: "Do not shift genus"},
                            {val: "none", label: game.loc(`genelab_genus_none`)},
                            ...Object.values(game.races).map(r => r.type).filter((g, i, a) => g && g !== "organism" && g !== "synthetic" && a.indexOf(g) === i).map(g => (
                            {val: g, label: game.loc(`genelab_genus_${g}`)}))];
        addSettingsSelect(currentNode, "shifterGenus", "Mimic genus", "Mimic selected genus, if avaialble. If you want to add some conditional overrides to this setting, keep in mind changing genus redraws game page, frequent changes can drastically harm game performance.", genusOptions);

        const imitateOptions = [{
                val: "ignore",
                label: "Ignore",
                hint: "Do not imitate race. IMPORTANT: script will stall at evolution if none selected"
            },
            ...Object.values(races)
                .map(race => {
                const label = game.global.stats.synth[race.id] ? race.name : `--${race.name}--`

                return {
                    val: race.id,
                    label,
                    hint: race.desc
                }
            })];

        addSettingsSelect(currentNode, "imitateRace", "Imitate race", "Imitate selected race, if available.", imitateOptions).on('change', 'select', function() {
            state.evolutionTarget = null;
            updateImitateWarning();
            resetTabHeight("evolutionSettings");
        });

        currentNode.append(`<div><span id="script_imitate_warning"></span></div>`);
        updateImitateWarning();

        let shrineOptions = [{val: "any", label: "Any", hint: "Build any Shrines, whenever have resources for it"},
                             {val: "equally", label: "Equally", hint: "Build all Shrines equally"},
                             {val: "morale", label: "Morale", hint: "Build only Morale Shrines"},
                             {val: "metal", label: "Metal", hint: "Build only Metal Shrines"},
                             {val: "know", label: "Knowledge", hint: "Build only Knowledge Shrines"},
                             {val: "tax", label: "Tax", hint: "Build only Tax Shrines"}];
        addSettingsSelect(currentNode, "buildingShrineType", "Magnificent shrine", "Auto Build shrines only at moons of chosen shrine", shrineOptions);
        addSettingsNumber(currentNode, "slaveIncome", "Minimum income to buy slave", "Script will use Slave Market only when money is capped, or have income above given number");

        let psychicOptions = [{val: "none", label: "Ignore", hint: "Psychic Powers ignored by script"},
                              {val: "auto", label: "Script Managed", hint: "Performs one of available actions in this order: Capture, Mind Break, Boost Profits, Boost Resource, Boost Attack Power."},
                               ...["boost", "murder", "assault", "profit", "stun", "mind_break"].map(p =>
                               ({val: p, label: game.loc(`psychic_${p}_title`), hint: game.loc(`psychic_${p}_desc`)}))];
        addSettingsSelect(currentNode, "psychicPower", "Psychic Powers", "Activates selected power with full energy. 10 murders required to research advanced powers will be performed automatically, if needed.", psychicOptions);

        let psychicBoost = [{val: "auto", label: "Script Managed", hint: "Resource selected by looking for highest income among ones having enough free storage room."},
                             ...Object.values(resources).filter(r => r.atomicMass > 0).map(r => ({val: r.id, label: r.title}))];
        addSettingsSelect(currentNode, "psychicBoostRes", "Boosted Resource", "Resource for Boost Resource Production psychic power.", psychicBoost);

        addSettingsToggle(currentNode, "jobScalePop", "High Pop job scale", "Auto Job will automatically scaly breakpoints to match population increase");

        // Minor Traits
        addStandardHeading(currentNode, "Minor Traits");

        let sequenceOptions = [{val: "none", label: "Ignore", hint: "Ignored by script, managed by game and player"},
                               {val: "enabled", label: "Enable", hint: "Sequencer enabled"},
                               {val: "disabled", label: "Disable", hint: "Sequencer disabled"},
                               {val: "decode", label: "Decode", hint: "Decode genome only, with no further mutations"}];
        addSettingsSelect(currentNode, "geneticsSequence", "Sequencer", "Manages genome decoding, and mutations", sequenceOptions);

        let boostOptions = [{val: "none", label: "Ignore", hint: "Ignored by script, managed by game and player"},
                            {val: "enabled", label: "Enable", hint: "Booster enabled"},
                            {val: "disabled", label: "Disable", hint: "Booster disabled"}];
        addSettingsSelect(currentNode, "geneticsBoost", "Sequence Booster", "Manages sequencer booster", boostOptions);

        let assembleOptions = [{val: "none", label: "Ignore", hint: "Ignored by script, managed by game and player"},
                               {val: "enabled", label: "Enable", hint: "Auto Sequencer enable"},
                               {val: "disabled", label: "Disable", hint: "Auto Sequencer disable"},
                               {val: "auto", label: "Script Managed", hint: "Gene assembling managed by script, allowing to dump excess knowledge at faster rate, matching income"}];
        addSettingsSelect(currentNode, "geneticsAssemble", "Auto Sequence", "Manages genome decoding, and mutations", assembleOptions);

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:20%">Minor Trait</th>
              <th class="has-text-warning" style="width:20%">Enabled</th>
              <th class="has-text-warning" style="width:20%">Weighting</th>
              <th class="has-text-warning" style="width:40%"></th>
            </tr>
            <tbody id="script_minorTraitTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_minorTraitTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < MinorTraitManager.priorityList.length; i++) {
            const trait = MinorTraitManager.priorityList[i];
            newTableBodyText += `<tr value="${trait.traitName}" class="script-draggable"><td id="script_minorTrait_${trait.traitName}" style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:40%"><span class="script-lastcolumn"></span></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other minorTraits settings rows
        for (let i = 0; i < MinorTraitManager.priorityList.length; i++) {
            const trait = MinorTraitManager.priorityList[i];
            let minorTraitElement = $('#script_minorTrait_' + trait.traitName);

            minorTraitElement.append(buildTableLabel(game.loc("trait_" + trait.traitName + "_name"), game.loc("trait_" + trait.traitName)));

            minorTraitElement = minorTraitElement.next();
            addTableToggle(minorTraitElement, "mTrait_" + trait.traitName);

            minorTraitElement = minorTraitElement.next();
            addTableInput(minorTraitElement, "mTrait_w_" + trait.traitName);
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let minorTraitNames = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < minorTraitNames.length; i++) {
                    settingsRaw['mTrait_p_' + minorTraitNames[i]] = i;
                }

                MinorTraitManager.sortByPriority();
                updateSettingsFromState();
            },
        });

        // Trait Mutations

        addStandardHeading(currentNode, "Trait Mutation");
        addSettingsToggle(currentNode, "doNotGoBelowPlasmidSoftcap", "Do not go below Plasmid softcap", "Script will not mutate if the number of remaining plasmids or anti plamids would be lower than the softcap (250 + Phage)");
        addSettingsNumber(currentNode, "minimumPlasmidsToPreserve", "Minimum Plasmids / Anti-Plasmids to preserve", "Script will not mutate if the number of remaining plasmids or anti plamids would be lower than this value");

        currentNode.append(`
        <table style="width:100%">
        <tr>
            <th class="has-text-warning" style="width:30%">Species / Genus</th>
            <th class="has-text-warning" style="width:25%">Trait</th>
            <th class="has-text-warning" style="width:10%">Cost</th>
            <th class="has-text-warning" style="width:10%">Add</th>
            <th class="has-text-warning" style="width:10%">Remove</th>
            <th class="has-text-warning" style="width:10%">Reset</th>
            <th class="has-text-warning" style="width:5%"></th>
        </tr>
        <tbody id="script_mutateTraitTableBody"></tbody>
        </table>`);

        let mutateTraitTableBodyNode = $("#script_mutateTraitTableBody");
        newTableBodyText = "";

        for (let i = 0; i < MutableTraitManager.priorityList.length; i++) {
            const trait = MutableTraitManager.priorityList[i];
            newTableBodyText += `<tr value="${trait.traitName}" class="script-draggable"><td id="script_mutableTrait_${trait.traitName}" style="width:30%"></td><td style="width:25%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:10%"></td><td style="width:5%"><span class="script-lastcolumn"></span></td></tr>`;
        }
        mutateTraitTableBodyNode.append($(newTableBodyText));

        // Build all other mutableTraits settings rows
        for (let i = 0; i < MutableTraitManager.priorityList.length; i++) {
            const trait = MutableTraitManager.priorityList[i];
            let mutableTraitElement = $("#script_mutableTrait_" + trait.traitName);

            mutableTraitElement.append(buildTableLabel(trait.source === "" ? "-" : game.loc((trait.type === "major" ? "race_" : "genelab_genus_") + trait.source), trait.type === "major" ? "Major" : "Genus", trait.type === "genus" ? "has-text-special" : "has-text"));

            mutableTraitElement = mutableTraitElement.next();
            mutableTraitElement.append(buildTableLabel(trait.name, game.loc("trait_" + trait.traitName), trait.isPositive ? "has-text-success" : "has-text-danger"));

            mutableTraitElement = mutableTraitElement.next();
            mutableTraitElement.append(buildTableLabel(`${trait.baseCost * 5}`, `${trait.baseCost * 5 * mutationCostMultipliers['custom']['gain']} for Custom${trait.traitName !== 'ooze' ? " and Sludge" : ""}`));

            mutableTraitElement = mutableTraitElement.next();
            if (trait.isGainable()) { // TODO check if beast_of_burden can be gained by other races during winter event.
                addTableToggle(mutableTraitElement, "mutableTrait_gain_" + trait.traitName);
            }

            mutableTraitElement = mutableTraitElement.next();
            addTableToggle(mutableTraitElement, "mutableTrait_purge_" + trait.traitName);

            if (trait.isGainable()) {
                makeToggleSwitchesMutuallyExclusive($(".script_mutableTrait_gain_" + trait.traitName), "mutableTrait_gain_" + trait.traitName, $(".script_mutableTrait_purge_" + trait.traitName), "mutableTrait_purge_" + trait.traitName);
            }

            mutableTraitElement = mutableTraitElement.next();
            if (poly.neg_roll_traits.includes(trait.traitName)) {
                addTableToggle(mutableTraitElement, "mutableTrait_reset_" + trait.traitName);
            }
        }

        mutateTraitTableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let mutableTraitNames = mutateTraitTableBodyNode.sortable("toArray", {attribute: "value"});
                for (let i = 0; i < mutableTraitNames.length; i++) {
                    settingsRaw["mutableTrait_p_" + mutableTraitNames[i]] = i;
                }

                MutableTraitManager.sortByPriority();
                updateSettingsFromState();
            },
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function makeToggleSwitchesMutuallyExclusive(switch1, settingsKey1, switch2, settingsKey2)
    {
        switch1.on("change", function() {
            if (switch1.prop("checked") && switch2.prop("checked")) {
                switch2.prop("checked", false);
                settingsRaw[settingsKey2] = false;
                updateSettingsFromState();
            }
        });
        switch2.on("change", function() {
            if (switch1.prop("checked") && switch2.prop("checked")) {
                switch1.prop("checked", false);
                settingsRaw[settingsKey1] = false;
                updateSettingsFromState();
            }
        });
    }

    function buildMagicSettings() {
        let sectionId = "magic";
        let sectionName = "Magic";

        let resetFunction = function() {
            resetMagicSettings(true);
            updateSettingsFromState();
            updateMagicSettingsContent();

            resetCheckbox("autoAlchemy", "autoPylon");
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateMagicSettingsContent);
    }

    function updateMagicSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_magicContent');
        currentNode.empty().off("*");

        updateMagicAlchemy(currentNode);
        updateMagicPylon(currentNode);

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function updateMagicAlchemy(currentNode) {
        addStandardHeading(currentNode, "Alchemy");
        addSettingsNumber(currentNode, "magicAlchemyManaUse", "Mana income used", "Income portion to use on alchemy. Setting to 1 is not recommended, leftover mana will be used for rituals.");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:20%">Resource</th>
              <th class="has-text-warning" style="width:20%">Enabled</th>
              <th class="has-text-warning" style="width:20%">Weighting</th>
              <th class="has-text-warning" style="width:40%"></th>
            </tr>
            <tbody id="script_alchemyTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_alchemyTableBody');
        let newTableBodyText = "";

        for (let resource of AlchemyManager.priorityList) {
            newTableBodyText += `<tr><td id="script_alchemy_${resource.id}" style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:40%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        for (let resource of AlchemyManager.priorityList) {
            let node = $('#script_alchemy_' + resource.id);

            let color = AlchemyManager.transmuteTier(resource) > 1 ? "has-text-advanced" : "has-text-info";
            node.append(buildTableLabel(resource.name, "", color));

            node = node.next();
            addTableToggle(node, "res_alchemy_" + resource.id);

            node = node.next();
            addTableInput(node, "res_alchemy_w_" + resource.id);
        }
    }

    function buildProductionSettings() {
        let sectionId = "production";
        let sectionName = "Production";

        let resetFunction = function() {
            resetProductionSettings(true);
            updateSettingsFromState();
            updateProductionSettingsContent();

            resetCheckbox("autoQuarry", "autoMine", "autoExtractor", "autoGraphenePlant", "autoSmelter", "autoCraft", "autoFactory", "autoMiningDroid");
            removeCraftToggles();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateProductionSettingsContent);
    }

    function updateProductionSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_productionContent');
        currentNode.empty().off("*");

        addSettingsNumber(currentNode, "productionChrysotileWeight", "Chrysotile weighting (Quarry, Smoldering)", "Chrysotile weighting for autoQuarry, applies after adjusting to difference between current amounts of Stone and Chrysotile");
        addSettingsNumber(currentNode, "productionAdamantiteWeight", "Adamantite weighting (Mine, The True Path)", "Adamantite weighting for autoMine, applies after adjusting to difference between current amounts of Aluminium and Adamantite");
        addSettingsNumber(currentNode, "productionExtWeight_common", "Aluminium weighting (Extractor Ship, The True Path)", "Aluminium weighting for autoExtractor, applies after adjusting to difference between current amounts of Iron and Aluminium");
        addSettingsNumber(currentNode, "productionExtWeight_uncommon", "Neutronium weighting (Extractor Ship, The True Path)", "Neutronium weighting for autoExtractor, applies after adjusting to difference between current amounts of Iridium and Neutronium");
        addSettingsNumber(currentNode, "productionExtWeight_rare", "Elerium weighting (Extractor Ship, The True Path)", "Elerium weighting for autoExtractor, applies after adjusting to difference between current amounts of Orichalcum and Elerium");

        updateProductionTableSmelter(currentNode);
        updateProductionTableFoundry(currentNode);
        updateProductionTableFactory(currentNode);
        updateProductionTableMiningDrone(currentNode);
        updateProductionTableReplicator(currentNode);

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function updateProductionTableSmelter(currentNode) {
        addStandardHeading(currentNode, "Smelter");

        let smelterOptions = [{val: "iron", label: "Prioritize Iron", hint: "Produce only Iron, untill storage capped, and switch to Steel after that"},
                              {val: "steel", label: "Prioritize Steel", hint: "Produce as much Steel as possible, untill storage capped, and switch to Iron after that"},
                              {val: "storage", label: "Up to full storages", hint: "Produce both Iron and Steel at ratio which will fill both storages at same time for both"},
                              {val: "required", label: "Up to required amounts", hint: "Produce both Iron and Steel at ratio which will produce maximum amount of resources required for buildings at same time for both"}];
        addSettingsSelect(currentNode, "productionSmelting", "Smelters production", "Distribution of smelters between iron and steel", smelterOptions);
        addSettingsNumber(currentNode, "productionSmeltingIridium", "Iridium ratio", "Share of smelters dedicated to Iridium");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:95%">Fuel</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_productionTableBodySmelter"></tbody>
          </table>`);

        let tableBodyNode = $('#script_productionTableBodySmelter');
        let newTableBodyText = "";

        let smelterFuels = SmelterManager.managedFuelPriorityList();

        for (let i = 0; i < smelterFuels.length; i++) {
            let fuel = smelterFuels[i];
            newTableBodyText += `<tr value="${fuel.id}" class="script-draggable"><td id="script_smelter_${fuel.id}" style="width:95%"></td><td style="width:5%"><span class="script-lastcolumn"></span></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other productions settings rows
        for (let i = 0; i < smelterFuels.length; i++) {
            let fuel = smelterFuels[i];
            let productionElement = $('#script_smelter_' + fuel.id);

            productionElement.append(buildTableLabel(fuel.id));
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let fuelIds = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < fuelIds.length; i++) {
                    settingsRaw["smelter_fuel_p_" + fuelIds[i]] = i;
                }

                updateSettingsFromState();
            },
        });
    }

    function updateProductionTableFactory(currentNode) {
        addStandardHeading(currentNode, "Factory");
        addSettingsNumber(currentNode, "productionFactoryMinIngredients", "Minimum materials to preserve", "Factory will craft resources only when all required materials above given ratio");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:35%">Resource</th>
              <th class="has-text-warning" style="width:20%">Enabled</th>
              <th class="has-text-warning" style="width:20%">Weighting</th>
              <th class="has-text-warning" style="width:20%">Priority</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_productionTableBodyFactory"></tbody>
          </table>`);

        let tableBodyNode = $('#script_productionTableBodyFactory');
        let newTableBodyText = "";

        let productionSettings = Object.values(FactoryManager.Productions);

        for (let i = 0; i < productionSettings.length; i++) {
            let production = productionSettings[i];
            newTableBodyText += `<tr><td id="script_factory_${production.resource.id}" style="width:35%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:5%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other productions settings rows
        for (let i = 0; i < productionSettings.length; i++) {
            let production = productionSettings[i];
            let productionElement = $('#script_factory_' + production.resource.id);

            productionElement.append(buildTableLabel(production.resource.name));

            productionElement = productionElement.next();
            addTableToggle(productionElement, "production_" + production.resource.id);

            productionElement = productionElement.next();
            addTableInput(productionElement, "production_w_" + production.resource.id);

            productionElement = productionElement.next();
            addTableInput(productionElement, "production_p_" + production.resource.id);
        }
    }

    function updateProductionTableFoundry(currentNode) {
        addStandardHeading(currentNode, "Foundry");
        let weightingOptions = [{val: "none", label: "None", hint: "Use configured weightings with no additional adjustments, craftables with x2 weighting will be crafted two times more intense than with x1, etc."},
                                {val: "demanded", label: "Prioritize demanded", hint: "Ignore craftables once stored amount surpass cost of most expensive building, until all missing resources will be crafted. After that works as with 'none' adjustments."},
                                {val: "buildings", label: "Buildings weightings", hint: "Uses weightings of buildings which are waiting for craftables, as multipliers to craftables weighting. This option requires autoBuild."}];
        addSettingsSelect(currentNode, "productionFoundryWeighting", "Weightings adjustments", "Configures how exactly craftables will be weighted against each other", weightingOptions);

        let assignOptions = [{val: "always", label: "Always", hint: "Always assign all craftsmens"},
                             {val: "nocraft", label: "No Manual Crafting", hint: "Assign workers only manual crafting is not possible, servants still always will be assigned"},
                             {val: "advanced", label: "Advanced", hint: "Assign workers only to advanced craftables(Scarletite, Quantium), basic craftables will be crafted by servants"},
                             {val: "servants", label: "Servants", hint: "Assign only servants"}];
        addSettingsSelect(currentNode, "productionCraftsmen", "Assign craftsmen", "Configures when workers should be assigned to crafting jobs", assignOptions);


        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:21%" title="Resource name">Resource</th>
              <th class="has-text-warning" style="width:17%" title="Resource won't ever be crafted with this option disabled">Enabled</th>
              <th class="has-text-warning" style="width:17%" title="Resource won't use foundry workers for craft with this option disabled">Craftsmen</th>
              <th class="has-text-warning" style="width:20%" title="Ratio between resources. Script assign craftsmans to resource with lowest 'amount / weighting'. Ignored by manual crafting.">Weighting</th>
              <th class="has-text-warning" style="width:20%" title="Only craft resource when storage ratio of all required materials above given number. E.g. bricks with 0.1 min materials will be crafted only when cement storage at least 10% filled.">Min Materials</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_productionTableBodyFoundry"></tbody>
          </table>`);

        let tableBodyNode = $('#script_productionTableBodyFoundry');
        let newTableBodyText = "";

        for (let i = 0; i < craftablesList.length; i++) {
            let resource = craftablesList[i];
            newTableBodyText += `<tr><td id="script_foundry_${resource.id}" style="width:21%"></td><td style="width:17%"></td><td style="width:17%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:5%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other productions settings rows
        for (let i = 0; i < craftablesList.length; i++) {
            let resource = craftablesList[i];
            let productionElement = $('#script_foundry_' + resource.id);

            productionElement.append(buildTableLabel(resource.name));

            // TODO: Make two toggles, for manual craft and foundry
            productionElement = productionElement.next();
            addTableToggle(productionElement, "craft" + resource.id);

            productionElement = productionElement.next();
            addTableToggle(productionElement, "job_" + resource.id);

            productionElement = productionElement.next();
            if (resource === resources.Scarletite || resource === resources.Quantium) {
                productionElement.append('<span>Managed</span>');
            } else {
                addTableInput(productionElement, "foundry_w_" + resource.id);
            }

            productionElement = productionElement.next();
            addTableInput(productionElement, "foundry_p_" + resource.id);
        }
    }

    function updateProductionTableMiningDrone(currentNode) {
        addStandardHeading(currentNode, "Mining Droid");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:35%">Resource</th>
              <th class="has-text-warning" style="width:20%"></th>
              <th class="has-text-warning" style="width:20%">Weighting</th>
              <th class="has-text-warning" style="width:20%">Priority</th>
              <th style="width:5%"></th>
            </tr>
            <tbody id="script_productionTableBodyMiningDrone"></tbody>
          </table>`);

        let tableBodyNode = $('#script_productionTableBodyMiningDrone');
        let newTableBodyText = "";

        let droidProducts = Object.values(DroidManager.Productions);

        for (let i = 0; i < droidProducts.length; i++) {
            let production = droidProducts[i];
            newTableBodyText += `<tr><td id="script_droid_${production.resource.id}" style="width:35%"><td style="width:20%"></td><td style="width:20%"></td></td><td style="width:20%"></td><td style="width:5%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other productions settings rows
        for (let i = 0; i < droidProducts.length; i++) {
            let production = droidProducts[i];
            let productionElement = $('#script_droid_' + production.resource.id);

            productionElement.append(buildTableLabel(production.resource.name));

            productionElement = productionElement.next().next();
            addTableInput(productionElement, "droid_w_" + production.resource.id);

            productionElement = productionElement.next();
            addTableInput(productionElement, "droid_pr_" + production.resource.id);
        }
    }

    function updateProductionTableReplicator(currentNode) {
        addStandardHeading(currentNode, "Replicator");

        addSettingsToggle(currentNode, 'replicatorAssignGovernorTask', 'Assign governor task', 'If active, the replicator scheduler governor task will be set, the power adjustment will be enabled.')

        currentNode.append(`
        <table style="width:100%">
          <tr>
            <th class="has-text-warning" style="width:35%">Resource</th>
            <th class="has-text-warning" style="width:20%">Enabled</th>
            <th class="has-text-warning" style="width:20%">Weighting</th>
            <th class="has-text-warning" style="width:20%">Priority</th>
            <th style="width:5%"></th>
          </tr>
          <tbody id="script_productionTableBodyReplicator"></tbody>
        </table>`);

      let tableBodyNode = $('#script_productionTableBodyReplicator');
      let newTableBodyText = "";

      let replicatorProducts = Object.values(ReplicatorManager.Productions);

      for (let i = 0; i < replicatorProducts.length; i++) {
          let production = replicatorProducts[i];
          newTableBodyText += `<tr><td id="script_replicator_${production.resource.id}" style="width:35%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:20%"></td><td style="width:5%"></td></tr>`;
      }
      tableBodyNode.append($(newTableBodyText));

      // Build all other productions settings rows
      for (let i = 0; i < replicatorProducts.length; i++) {
          let production = replicatorProducts[i];
          let productionElement = $('#script_replicator_' + production.resource.id);

          productionElement.append(buildTableLabel(production.resource.name));

          productionElement = productionElement.next();
          addTableToggle(productionElement, "replicator_" + production.resource.id);

          productionElement = productionElement.next();
          addTableInput(productionElement, "replicator_w_" + production.resource.id);

          productionElement = productionElement.next();
          addTableInput(productionElement, "replicator_p_" + production.resource.id);
      }
    }

    function updateMagicPylon(currentNode) {
        addStandardHeading(currentNode, "Pylon");
        addSettingsNumber(currentNode, "productionRitualManaUse", "Mana income used", "Income portion to use on rituals. Setting to 1 is not recommended, as it will halt mana regeneration. Applied only when mana not capped - with capped mana script will always use all income.");
        addSettingsToggle(currentNode, "productionRitualSafe", "Safe rituals", "Limit max rituals to safe, unsuspicious amount. Have no effect out of Witch Hunter scenario.");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:55%">Ritual</th>
              <th class="has-text-warning" style="width:20%">Weighting</th>
              <th style="width:25%"></th>
            </tr>
            <tbody id="script_magicTableBodyPylon"></tbody>
          </table>`);

        let tableBodyNode = $('#script_magicTableBodyPylon');
        let newTableBodyText = "";

        let pylonProducts = Object.values(RitualManager.Productions);

        for (let i = 0; i < pylonProducts.length; i++) {
            let production = pylonProducts[i];
            newTableBodyText += `<tr><td id="script_pylon_${production.id}" style="width:55%"></td><td style="width:20%"></td><td style="width:25%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other productions settings rows
        for (let i = 0; i < pylonProducts.length; i++) {
            let production = pylonProducts[i];
            let productionElement = $('#script_pylon_' + production.id);

            productionElement.append(buildTableLabel(game.loc(`modal_pylon_spell_${production.id}`)));

            productionElement = productionElement.next();
            addTableInput(productionElement, "spell_w_" + production.id);
        }
    }

    function buildJobSettings() {
        let sectionId = "job";
        let sectionName = "Job";

        let resetFunction = function() {
            resetJobSettings(true);
            updateSettingsFromState();
            updateJobSettingsContent();

            resetCheckbox("autoJobs", "autoCraftsmen");
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateJobSettingsContent);
    }

    function updateJobSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_jobContent');
        currentNode.empty().off("*");

        addSettingsToggle(currentNode, "jobSetDefault", "Set default job", "Automatically sets the default job in order of Quarry Worker -> Lumberjack -> Crystal Miner -> Scavenger -> Hunter -> Farmer -> Unemployed");
        addSettingsToggle(currentNode, "jobManageServants", "Manage Servants", "Automatically manage servants, they will be used as substitute of regular workers, sharing same breakpoints and priorities, i.e. for breakpoint 10 script might assign 8 workers and 2 servants, and such.");
        addSettingsNumber(currentNode, "jobLumberWeighting", "Final Lumberjack Weighting", "AFTER allocating breakpoints this weighting will be used to split weighted jobs");
        addSettingsNumber(currentNode, "jobQuarryWeighting", "Final Quarry Worker Weighting", "AFTER allocating breakpoints this weighting will be used to split weighted jobs");
        addSettingsNumber(currentNode, "jobCrystalWeighting", "Final Crystal Miner Weighting", "AFTER allocating breakpoints this weighting will be used to split weighted jobs");
        addSettingsNumber(currentNode, "jobScavengerWeighting", "Final Scavenger Weighting", "AFTER allocating breakpoints this weighting will be used to split weighted jobs");
        addSettingsNumber(currentNode, "jobRaiderWeighting", "Final Raider Weighting", "AFTER allocating breakpoints this weighting will be used to split weighted jobs");
        addSettingsToggle(currentNode, "jobDisableMiners", "Disable miners in Andromeda", "Disable Miners and Coal Miners after reaching Andromeda");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:35%">Job</th>
              <th class="has-text-warning" style="width:17%">1st Pass</th>
              <th class="has-text-warning" style="width:17%">2nd Pass</th>
              <th class="has-text-warning" style="width:17%">3rd Pass</th>
              <th class="has-text-warning" style="width:9%" title="When enabled script will limit amount of assigned workers down to maximum useful quantity, moving idling workers to other jobs">Smart</th>
              <td style="width:5%"><span id="script_resetJobsPriority" class="script-refresh"></span></td>
            </tr>
            <tbody id="script_jobTableBody"></tbody>
          </table>`);

        $('#script_resetJobsPriority').on("click", function(){
            if (confirm("Are you sure you wish to reset jobs priority?")) {
                JobManager.priorityList = Object.values(jobs);
                for (let i = 0; i < JobManager.priorityList.length; i++) {
                    let id = JobManager.priorityList[i]._originalId;
                    settingsRaw['job_p_' + id] = i;
                }
                updateSettingsFromState();
                updateJobSettingsContent();
            }
        });

        let tableBodyNode = $('#script_jobTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < JobManager.priorityList.length; i++) {
            const job = JobManager.priorityList[i];
            newTableBodyText += `<tr value="${job._originalId}" class="script-draggable"><td id="script_${job._originalId}" style="width:35%"></td><td style="width:17%"></td><td style="width:17%"></td><td style="width:17%"></td><td style="width:9%"></td><td style="width:5%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        for (let i = 0; i < JobManager.priorityList.length; i++) {
            const job = JobManager.priorityList[i];
            let jobElement = $('#script_' + job._originalId);

            buildJobSettingsToggle(jobElement, job);
            jobElement = jobElement.next();
            buildJobSettingsInput(jobElement, job, 1);
            jobElement = jobElement.next();
            buildJobSettingsInput(jobElement, job, 2);
            jobElement = jobElement.next();
            buildJobSettingsInput(jobElement, job, 3);
            jobElement = jobElement.next();
            if (job.is.smart) {
                addTableToggle(jobElement, "job_s_" + job._originalId);
            }

            jobElement = jobElement.next();
            jobElement.append($('<span class="script-lastcolumn"></span>'));
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let sortedIds = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < sortedIds.length; i++) {
                    settingsRaw['job_p_' + sortedIds[i]] = i;
                }

                JobManager.sortByPriority();
                updateSettingsFromState();
            },
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildJobSettingsToggle(node, job) {
        let settingKey = "job_" + job._originalId;
        let color = job === jobs.Unemployed ? 'warning' : job instanceof CraftingJob ? 'danger' : job instanceof BasicJob ? 'info' : 'advanced';
        node.addClass("script_bg_" + settingKey + (settingsRaw.overrides[settingKey] ? " inactive-row" : ""))
            .append(addToggleCallbacks($(`
          <label tabindex="0" class="switch" style="margin-top:4px; margin-left:10px;">
            <input class="script_${settingKey}" type="checkbox"${settingsRaw[settingKey] ? " checked" : ""}>
            <span class="check" style="height:5px; max-width:15px"></span>
            <span class="has-text-${color}" style="margin-left: 20px;">${job._originalName}</span>
          </label>`), settingKey));
    }

    function buildJobSettingsInput(node, job, breakpoint) {
        if (job instanceof CraftingJob) {
            node.append(`<span>Managed</span>`);
        } else if (breakpoint === 3 && job.is.split) {
            node.append(`<span>Weighted</span>`);
        } else {
            addTableInput(node, `job_b${breakpoint}_${job._originalId}`);
        }
    }

    function buildWeightingSettings() {
        let sectionId = "weighting";
        let sectionName = "AutoBuild Weighting";

        let resetFunction = function() {
            resetWeightingSettings(true);
            updateSettingsFromState();
            updateWeightingSettingsContent();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateWeightingSettingsContent);
    }

    function updateWeightingSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_weightingContent');
        currentNode.empty().off("*");

        addSettingsToggle(currentNode, "buildingBuildIfStorageFull", "Ignore weighting and build if any storage is full", "Ignore weighting and immediately construct building if it uses any capped resource, preventing wasting them by overflowing. Weight still need to be positive(above zero) for this to happen.");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:30%">Target</th>
              <th class="has-text-warning" style="width:60%">Condition</th>
              <th class="has-text-warning" style="width:10%">Multiplier</th>
            </tr>
            <tbody id="script_weightingTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_weightingTableBody');

        addWeightingRule(tableBodyNode, "Any", "New building", "buildingWeightingNew");
        addWeightingRule(tableBodyNode, "Powered building", "Low available energy", "buildingWeightingUnderpowered");
        addWeightingRule(tableBodyNode, "Power plant", "Low available energy", "buildingWeightingNeedfulPowerPlant");
        addWeightingRule(tableBodyNode, "Power plant", "Producing more energy than required", "buildingWeightingUselessPowerPlant");
        addWeightingRule(tableBodyNode, "Knowledge storage", "Have unlocked unafforable researches", "buildingWeightingNeedfulKnowledge");
        addWeightingRule(tableBodyNode, "Knowledge storage", "All unlocked researches already affordable", "buildingWeightingUselessKnowledge");
        addWeightingRule(tableBodyNode, "Building with state (city)", "Some instances of this building are not working", "buildingWeightingNonOperatingCity");
        addWeightingRule(tableBodyNode, "Building with state (space)", "Some instances of this building are not working", "buildingWeightingNonOperating");
        addWeightingRule(tableBodyNode, "Building with consumption", "Missing consumables to operate", "buildingWeightingMissingSupply");
        addWeightingRule(tableBodyNode, "Support consumer", "Missing support to operate", "buildingWeightingMissingSupport");
        addWeightingRule(tableBodyNode, "Support provider", "Provided support not currently needed", "buildingWeightingUselessSupport");
        addWeightingRule(tableBodyNode, "All fuel depots", "Missing Oil or Helium for techs and missions", "buildingWeightingMissingFuel");
        addWeightingRule(tableBodyNode, "Not housing, barrack, oil derrick, or knowledge building", "MAD prestige enabled, and affordable", "buildingWeightingMADUseless");
        addWeightingRule(tableBodyNode, "Mass Ejector", "Existed ejectors not fully utilized", "buildingWeightingUnusedEjectors");
        addWeightingRule(tableBodyNode, "Freight Yard, Container Port, Munitions Depot", "Have unused crates or containers", "buildingWeightingCrateUseless");
        addWeightingRule(tableBodyNode, "Horseshoes", "No more Horseshoes needed", "buildingWeightingHorseshoeUseless");
        addWeightingRule(tableBodyNode, "Meditation Chamber", "No more Meditation Space needed", "buildingWeightingZenUseless");
        addWeightingRule(tableBodyNode, "Gate Turret", "Gate demons fully supressed", "buildingWeightingGateTurret");
        addWeightingRule(tableBodyNode, "Warehouses, Garage, Cargo Yard, Storehouse", "Need more storage", "buildingWeightingNeedStorage");
        addWeightingRule(tableBodyNode, "Housing", "Less than 90% of houses are used", "buildingWeightingUselessHousing");
        addWeightingRule(tableBodyNode, "Orbital Decay", "City and Moon buildings", "buildingWeightingTemporal");
        addWeightingRule(tableBodyNode, "The True Path", "Solar buildings after reaching Tau Ceti", "buildingWeightingSolar");
        addWeightingRule(tableBodyNode, "Womlings Missions", "Womlings unlock actions conflicting with Overlord", "buildingWeightingOverlord");

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function addWeightingRule(table, targetName, conditionDesc, settingKey){
        let ruleNode = $(`
          <tr>
            <td style="width:30%"><span class="has-text-info">${targetName}</span></td>
            <td style="width:60%"><span class="has-text-info">${conditionDesc}</span></td>
            <td style="width:10%"></td>
          </tr>`);
        addTableInput(ruleNode.find('td:eq(2)'), settingKey);
        table.append(ruleNode);
    }

    function buildBuildingSettings() {
        let sectionId = "building";
        let sectionName = "Building";

        let resetFunction = function() {
            resetBuildingSettings(true);
            updateSettingsFromState();
            updateBuildingSettingsContent();

            resetCheckbox("autoBuild", "autoPower");
            removeBuildingToggles();
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateBuildingSettingsContent);
    }

    function updateBuildingSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_buildingContent');
        currentNode.empty().off("*");

        addSettingsToggle(currentNode, "buildingsIgnoreZeroRate", "Do not wait for resources without income", "Weighting checks will ignore resources without positive income(craftables, inactive factory goods, etc), buildings with such resources will not delay other buildings.");
        addSettingsToggle(currentNode, "buildingsLimitPowered", "Limit amount of powered buildings", "With this option enabled Max Build will prevent powering extra building. Can be useful to disable buildings with overrided settings.");
        addSettingsToggle(currentNode, "buildingsTransportGem", "Build cheapest Supplies transport", "By default script chooses between Lake Transport and Lake Bireme Warship comparing their 'Supplies Per Support', with this option enabled it will compare 'Supplies Per Soulgems' instead.");
        addSettingsToggle(currentNode, "buildingsBestFreighter", "Build most efficient freighters", "With this option enabled script will compare 'Money Storage per Crew' of Freighter and Super Freighter, and only build the best one. Without this option no restrictions will be applied. Works only when both ships are buildable.");
        addSettingsToggle(currentNode, "buildingsUseMultiClick", "Bulk build multi-segmented buildings", "With this option enabled, the script will build as many segments as are affordable at once, instead of one per tick.");
        addSettingsNumber(currentNode, "buildingTowerSuppression", "Minimum suppression for Towers", "East Tower and West Tower won't be built until minimum suppression is reached");

        currentNode.append(`
          <div><input id="script_buildingSearch" class="script-searchsettings" type="text" placeholder="Search for buildings..."></div>
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:35%">Building</th>
              <th class="has-text-warning" style="width:15%" title="Enables auto building. Triggers ignores this option, allowing to build disabled things.">Auto Build</th>
              <th class="has-text-warning" style="width:15%" title="Maximum amount of buildings to build. Triggers ignores this option, allowing to build above limit. Can be also used to limit amount of enabled buildings, with respective option above.">Max Build</th>
              <th class="has-text-warning" style="width:15%" title="Script will try to spend 2x amount of resources on building having 2x weighting, and such.">Weighting</th>
              <th class="has-text-warning" style="width:20%" title="First toggle enables basic automation based on priority, power, support, and consumption. Second enables logic made specially for particlular building, their effects are different, but generally it tries to behave smarter than just staying enabled all the time.">Auto Power</th>
            </tr>
            <tbody id="script_buildingTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_buildingTableBody');

        $("#script_buildingSearch").on("keyup", filterBuildingSettingsTable); // Add building filter

        // Add in a first row for switching "All"
        let newTableBodyText = '<tr value="All" class="unsortable"><td id="script_bldallToggle" style="width:35%"></td><td style="width:15%"></td><td style="width:15%"></td><td style="width:15%"></td><td style="width:20%"><span id="script_resetBuildingsPriority" class="script-refresh"></span></td></tr>';

        for (let i = 0; i < BuildingManager.priorityList.length; i++) {
            let building = BuildingManager.priorityList[i];
            newTableBodyText += `<tr value="${building._vueBinding}" class="script-draggable"><td id="script_${building._vueBinding}" style="width:35%"></td><td style="width:15%"></td><td style="width:15%"></td><td style="width:15%"></td><td style="width:20%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build special "All Buildings" top row
        let buildingElement = $('#script_bldallToggle');
        buildingElement.append('<span class="has-text-warning" style="margin-left: 20px;">All Buildings</span>');

        // enabled column
        buildingElement = buildingElement.next();
        buildingElement.append(buildAllBuildingEnabledSettingsToggle());

        // state column
        buildingElement = buildingElement.next().next().next();
        buildingElement.append(buildAllBuildingStateSettingsToggle());

        $('#script_resetBuildingsPriority').on("click", function(){
            if (confirm("Are you sure you wish to reset buildings priority?")) {
                initBuildingState();
                for (let i = 0; i < BuildingManager.priorityList.length; i++) {
                    let id = BuildingManager.priorityList[i]._vueBinding;
                    settingsRaw['bld_p_' + id] = i;
                }
                updateSettingsFromState();
                updateBuildingSettingsContent();
            }
        });

        // Build all other buildings settings rows
        for (let i = 0; i < BuildingManager.priorityList.length; i++) {
            let building = BuildingManager.priorityList[i];
            let buildingElement = $('#script_' + building._vueBinding);

            let color = (building._tab === "space" || building._tab === "starDock") ? "has-text-danger" :
                        building._tab === "galaxy" ? "has-text-advanced" :
                        building._tab === "interstellar" ? "has-text-special" :
                        (building._tab === "portal" || building._tab === "tauceti") ? "has-text-warning" :
                        "has-text-info";

            buildingElement.append(buildTableLabel(building.name, "", color));

            buildingElement = buildingElement.next();
            addTableToggle(buildingElement, "bat" + building._vueBinding);

            buildingElement = buildingElement.next();
            addTableInput(buildingElement, "bld_m_" + building._vueBinding);

            buildingElement = buildingElement.next();
            addTableInput(buildingElement, "bld_w_" + building._vueBinding);

            buildingElement = buildingElement.next();
            buildBuildingStateSettingsToggle(buildingElement, building);
        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let buildingElements = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < buildingElements.length; i++) {
                    settingsRaw['bld_p_' + buildingElements[i]] = i;
                }

                BuildingManager.sortByPriority();
                updateSettingsFromState();
            },
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function filterBuildingSettingsTable() {
        // Declare variables
        let filter = document.getElementById("script_buildingSearch").value.toUpperCase();
        let trs = document.getElementById("script_buildingTableBody").getElementsByTagName("tr");

        let filterChecker = null;
        let reg = filter.match(/^(.+)(<=|>=|===|==|<|>|!==|!=)(.+)$/);
        if (reg?.length === 4) {
            let buildingValue = null;
            switch (reg[1].trim()) {
                case "BUILD":
                case "AUTOBUILD":
                    buildingValue = (b) => b.autoBuildEnabled;
                    break;
                case "POWER":
                case "AUTOPOWER":
                    buildingValue = (b) => b.autoStateEnabled;
                    break;
                case "WEIGHT":
                case "WEIGHTING":
                    buildingValue = (b) => b._weighting;
                    break;
                case "MAX":
                case "MAXBUILD":
                    buildingValue = (b) => b._autoMax;
                    break;
                case "POWERED":
                    buildingValue = (b) => b.powered;
                    break;
                case "KNOW":
                case "KNOWLEDGE":
                    buildingValue = (b) => b.is.knowledge;
                    break;
                default: // Cost check, get resource quantity by part of name
                    buildingValue = (b) => Object.entries(b.cost).find(([res, qnt]) => resources[res].title.toUpperCase().indexOf(reg[1].trim()) > -1)?.[1] ?? 0;
            }
            let testValue = null;
            switch (reg[3].trim()) {
                case "ON":
                case "TRUE":
                    testValue = true;
                    break;
                case "OFF":
                case "FALSE":
                    testValue = false;
                    break;
                default:
                    testValue = getRealNumber(reg[3].trim());
                    break;
            }
            filterChecker = (building) => checkCompare[reg[2]](buildingValue(building), testValue);
        }

        // Loop through all table rows, and hide those who don't match the search query
        for (let i = 0; i < trs.length; i++) {
            let td = trs[i].getElementsByTagName("td")[0];
            if (td) {
                if (filterChecker) {
                    let building = buildingIds[td.id.match(/^script_(.*)$/)[1]];
                    if (building && filterChecker(building)) {
                        trs[i].style.display = "";
                    } else {
                        trs[i].style.display = "none";
                    }
                } else if (td.textContent.toUpperCase().indexOf(filter) > -1) {
                    trs[i].style.display = "";
                } else {
                    trs[i].style.display = "none";
                }
            }
        }
        resetTabHeight("buildingSettings");
    }

    function buildAllBuildingEnabledSettingsToggle() {
        return $(`
          <label tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;">
            <input class="script_buildingEnabledAll" type="checkbox"${settingsRaw.buildingEnabledAll ? " checked" : ""}>
            <span class="check" style="height:5px; max-width:15px"></span>
            <span style="margin-left: 20px;"></span>
          </label>`)
        .on('change', 'input', function() {
            settingsRaw.buildingEnabledAll = this.checked;
            for (let i = 0; i < BuildingManager.priorityList.length; i++) {
                let id = BuildingManager.priorityList[i]._vueBinding;
                settingsRaw['bat' + id] = this.checked;
            }
            $('[class^="script_bat"]').prop('checked', this.checked);

            updateSettingsFromState();
        })
        .on('click', function(event){
            if (event[overrideKey]) {
                event.preventDefault();
            }
        });
    }

    function buildBuildingStateSettingsToggle(node, building) {
        let stateKey = 'bld_s_' + building._vueBinding;
        let smartKey = 'bld_s2_' + building._vueBinding;

        if (building.isSwitchable()) {
            addToggleCallbacks($(`
              <label tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;">
                <input class="script_${stateKey}" type="checkbox"${settingsRaw[stateKey] ? " checked" : ""}>
                <span class="check" style="height:5px; max-width:15px"></span>
                <span style="margin-left: 20px;"></span>
              </label>`), stateKey)
            .appendTo(node);
            node.addClass("script_bg_" + stateKey);
        }

        if (building.is.smart) {
            let smartNode = $(`
              <label tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 35px;">
                <input class="script_${smartKey}" type="checkbox"${settingsRaw[smartKey] ? " checked" : ""}>
                <span class="check" style="height:5px; max-width:15px"></span>
                <span style="margin-left: 20px;"></span>
              </label>`);

            let set = linkedBuildings.find(set => set.includes(building));
            if (set) {
                smartNode.on('change', 'input', function() {
                    set.forEach(building => {
                        let linkedId = 'bld_s2_' + building._vueBinding;
                        settingsRaw[linkedId] = this.checked;
                        $(".script_" + linkedId).prop('checked', this.checked);
                    });
                    updateSettingsFromState();
                });
            } else {
                addToggleCallbacks(smartNode, smartKey);
            }
            node.append(smartNode);
            node.addClass("script_bg_" + smartKey);
        }

        node.append(`<span class="script-lastcolumn"></span>`);
        node.toggleClass('inactive-row', Boolean(settingsRaw.overrides[stateKey] || settingsRaw.overrides[smartKey]));
    }

    function buildAllBuildingStateSettingsToggle() {
        return $(`
          <label tabindex="0" class="switch" style="position:absolute; margin-top: 8px; margin-left: 10px;">
            <input class="script_buildingStateAll" type="checkbox"${settingsRaw.buildingStateAll ? " checked" : ""}>
            <span class="check" style="height:5px; max-width:15px"></span>
            <span style="margin-left: 20px;"></span>
          </label>`)
        .on('change', 'input', function(e) {
            settingsRaw.buildingStateAll = this.checked;
            for (let i = 0; i < BuildingManager.priorityList.length; i++) {
                let id = BuildingManager.priorityList[i]._vueBinding;
                settingsRaw['bld_s_' + id] = this.checked;
            }
            $('[class^="script_bld_s_"]').prop('checked', this.checked);

            updateSettingsFromState();
        })
        .on('click', function(event){
            if (event[overrideKey]) {
                event.preventDefault();
            }
        });
    }

    function buildProjectSettings() {
        let sectionId = "project";
        let sectionName = "A.R.P.A.";

        let resetFunction = function() {
            resetProjectSettings(true);
            updateSettingsFromState();
            updateProjectSettingsContent();

            resetCheckbox("autoARPA");
        };

        buildSettingsSection(sectionId, sectionName, resetFunction, updateProjectSettingsContent);
    }

    function updateProjectSettingsContent() {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $('#script_projectContent');
        currentNode.empty().off("*");

        addSettingsToggle(currentNode, "arpaScaleWeighting", "Scale weighting with progress", "Projects weighting scales  with current progress, making script more eager to spend resources on finishing nearly constructed projects.");
        addSettingsNumber(currentNode, "arpaStep", "Preferred progress step", "Projects will be weighted and build in this steps. Increasing number can speed up constructing. Step will be adjusted down when preferred step above remaining amount, or surpass storage caps. Weightings below will be multiplied by current step. Projects builded by triggers will always have maximum possible step.");

        currentNode.append(`
          <table style="width:100%">
            <tr>
              <th class="has-text-warning" style="width:25%">Project</th>
              <th class="has-text-warning" style="width:25%">Auto Build</th>
              <th class="has-text-warning" style="width:25%">Max Build</th>
              <th class="has-text-warning" style="width:25%">Weighting</th>
            </tr>
            <tbody id="script_projectTableBody"></tbody>
          </table>`);

        let tableBodyNode = $('#script_projectTableBody');
        let newTableBodyText = "";

        for (let i = 0; i < ProjectManager.priorityList.length; i++) {
            const project = ProjectManager.priorityList[i];
            newTableBodyText += `<tr value="${project.id}" class="script-draggable"><td id="script_${project.id}" style="width:25%"></td><td style="width:25%"></td><td style="width:25%"></td><td style="width:25%"></td><td style="width:25%"></td></tr>`;
        }
        tableBodyNode.append($(newTableBodyText));

        // Build all other projects settings rows
        for (let i = 0; i < ProjectManager.priorityList.length; i++) {
            const project = ProjectManager.priorityList[i];
            let projectElement = $('#script_' + project.id);

            projectElement.append(buildTableLabel(project.name));

            projectElement = projectElement.next();
            addTableToggle(projectElement, "arpa_" + project.id);

            projectElement = projectElement.next();
            addTableInput(projectElement, "arpa_m_" + project.id);

            projectElement = projectElement.next();
            addTableInput(projectElement, "arpa_w_" + project.id);

        }

        tableBodyNode.sortable({
            items: "tr:not(.unsortable)",
            helper: sorterHelper,
            update: function() {
                let projectIds = tableBodyNode.sortable('toArray', {attribute: 'value'});
                for (let i = 0; i < projectIds.length; i++) {
                    settingsRaw["arpa_p_" + projectIds[i]] = i;
                }

                ProjectManager.sortByPriority();
                updateSettingsFromState();
            },
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function buildLoggingSettings(parentNode, secondaryPrefix) {
        let sectionId = "logging";
        let sectionName = "Logging";

        let resetFunction = function() {
            resetLoggingSettings(true);
            updateSettingsFromState();
            updateLoggingSettingsContent(secondaryPrefix);
            buildFilterRegExp();
        };

        buildSettingsSection2(parentNode, secondaryPrefix, sectionId, sectionName, resetFunction, updateLoggingSettingsContent);
    }

    function updateLoggingSettingsContent(secondaryPrefix) {
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        let currentNode = $(`#script_${secondaryPrefix}loggingContent`);
        currentNode.empty().off("*");

        addSettingsHeader1(currentNode, "Script Messages");
        addSettingsToggle(currentNode, "logEnabled", "Enable logging", "Master switch to enable logging of script actions in the game message queue");
        Object.entries(GameLog.Types).forEach(([id, label]) => addSettingsToggle(currentNode, "log_" + id, label, `If logging is enabled then logs ${label} actions`));
        addSettingsString(currentNode, "log_prestige_format", "Prestige Log Format", "Available placeholders: {resetType}, {species}, {timestamp} (in game days). Use {eval: XXX } to log custom information");

        addSettingsHeader1(currentNode, "Game Messages");
        addSettingsToggle(currentNode, "hellTurnOffLogMessages", "Turn off patrol and surveyor log messages", "Automatically turns off the hell patrol and surveyor log messages");
        let stringsUrl = `strings/strings${game.global.settings.locale === "en-US" ? "" : "." + game.global.settings.locale}.json`
        currentNode.append(`
          <div>
            <span>List of message IDs to filter, all game messages can be found <a href="${stringsUrl}" target="_blank">here</a>.</span><br>
            <textarea id="script_logFilter" class="textarea" style="margin-top: 4px;">${settingsRaw.logFilter}</textarea>
          </div>`);

        // Settings textarea
        $("#script_logFilter").on('change', function() {
            settingsRaw.logFilter = this.value;
            buildFilterRegExp();
            this.value = settingsRaw.logFilter;
            updateSettingsFromState();
        });

        document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
    }

    function createQuickOptions(node, optionsElementId, optionsDisplayName, buildOptionsFunction) {
        let optionsDiv = $(`<div style="cursor: pointer;" id="${optionsElementId}">${optionsDisplayName} Options</div>`);
        node.append(optionsDiv);

        addOptionUI(optionsElementId + "_btn", `#${optionsElementId}`, optionsDisplayName, buildOptionsFunction);
        optionsDiv.on('click', function() {
            openOptionsModal(optionsDisplayName, buildOptionsFunction);
        });
    }

    function createSettingToggle(node, settingKey, title, enabledCallBack, disabledCallBack) {
        let toggle = $(`
          <label class="switch script_bg_${settingKey}" tabindex="0" title="${title}">
            <input class="script_${settingKey}" type="checkbox"${settingsRaw[settingKey] ? " checked" : ""}/>
            <span class="check"></span><span>${settingKey}</span>
          </label><br>`)
        .toggleClass('inactive-row', Boolean(settingsRaw.overrides[settingKey]));

        if (settingsRaw[settingKey] && enabledCallBack) {
            enabledCallBack();
        }

        toggle.on('change', 'input', function() {
            settingsRaw[settingKey] = this.checked;
            updateSettingsFromState();
            if (settingsRaw[settingKey] && enabledCallBack) {
                enabledCallBack();
            }
            if (!settingsRaw[settingKey] && disabledCallBack) {
                disabledCallBack();
            }
        });
        toggle.on('click', {label: `Toggle (${settingKey})`, name: settingKey, type: "boolean"}, openOverrideModal);

        node.append(toggle);
    }

    function updateOptionsUI() {
        // Build secondary options buttons if they don't currently exist
        addOptionUI("s-government-options", "#government .tabs ul", "Government", buildGovernmentSettings);
        addOptionUI("s-foreign-options", "#garrison div h2", "Foreign Affairs", buildWarSettings);
        addOptionUI("s-foreign-options2", "#c_garrison div h2", "Foreign Affairs", buildWarSettings);
        addOptionUI("s-hell-options", "#gFort div h3", "Hell", buildHellSettings);
        addOptionUI("s-hell-options2", "#prtl_fortress div h3", "Hell", buildHellSettings);
        addOptionUI("s-fleet-options", "#hfleet h3", "Fleet", buildFleetSettings);
    }

    function addOptionUI(optionsId, querySelectorText, modalTitle, buildOptionsFunction) {
        if (document.getElementById(optionsId) !== null) { return; } // We've already built the options UI

        let sectionNode = $(querySelectorText);

        if (sectionNode.length === 0) { return; } // The node that we want to add it to doesn't exist yet

        let newOptionNode = $(`<span id="${optionsId}" class="s-options-button has-text-success" style="margin-right:0px">+</span>`);
        sectionNode.prepend(newOptionNode);
        newOptionNode.on('click', function() {
            openOptionsModal(modalTitle, buildOptionsFunction);
        });
    }

    function openOptionsModal(modalTitle, buildOptionsFunction) {
        // Build content
        let modalHeader = $('#scriptModalHeader');
        modalHeader.empty().off("*");
        modalHeader.append(`<span style="user-select: text">${modalTitle}</span>`);

        let modalBody = $('#scriptModalBody');
        modalBody.empty().off("*");
        buildOptionsFunction(modalBody, "c_");

        // Show modal
        let modal = document.getElementById("scriptModal");
        $("html").css('overflow', 'hidden');
        modal.style.display = "block";
    }

    function createOptionsModal() {
        if (document.getElementById("scriptModal") !== null) {
            return;
        }

        // Append the script modal to the document
        $(document.body).append(`
          <div id="scriptModal" class="script-modal content">
            <span id="scriptModalClose" class="script-modal-close">&times;</span>
            <div class="script-modal-content">
              <div id="scriptModalHeader" class="script-modal-header has-text-warning">
                <p>You should never see this modal header...</p>
              </div>
              <div id="scriptModalBody" class="script-modal-body">
                <p>You should never see this modal body...</p>
              </div>
            </div>
          </div>`);

        // Add the script modal close button action
        $('#scriptModalClose').on("click", function() {
            $("#scriptModal").css('display', 'none');
            $('.script-modal-content').removeClass('override-modal');
            $("html").css('overflow-y', 'scroll');
        });

        // If the user clicks outside the modal then close it
        $(window).on("click", function(event) {
            if (event.target.id === "scriptModal") {
                $("#scriptModal").css('display', 'none');
                $('.script-modal-content').removeClass('override-modal');
                $("html").css('overflow-y', 'scroll');
            }
        });
    }

    function updatePrestigeInTopBar() {
        if (settings.displayPrestigeTypeInTopBar) {
            addPrestigeToTopBar();
        }
        else {
            removePrestigeFromTopBar();
        }

        let prestigeNode = document.getElementById("s-prestige-type");
        if (prestigeNode == null) { return; } // Element has not yet been added, cannot update

        let prestige = prestigeTypes.find(prest => prest.val === settings.prestigeType);
        prestigeNode.title = prestige.hint;
        prestigeNode.textContent = prestige.label;
    }

    function addPrestigeToTopBar() {
        let nodeId = "s-prestige-type";
        if (document.getElementById(nodeId) !== null) { return; } // We've already added the info to the top bar

        let planetWrapNode = $("#topBar .planetWrap");
        if (planetWrapNode.length === 0) { return; } // The node that we want to add it to doesn't exist yet

        planetWrapNode.append($(`<span id="s-prestige-type" style="border-left: 1px solid; margin-left: 1rem; padding-left: 1rem;" ></span>`));
    }

    function removePrestigeFromTopBar() {
        let prestigeNode = document.getElementById("s-prestige-type");
        if (prestigeNode == null) { return; } // Element has not yet been added, nothing to do

        prestigeNode.remove();
    }

    function updateTotalDaysInTopBar() {
        if (settings.displayTotalDaysTypeInTopBar) {
            addTotalDaysToTopBar();
        } else {
            removeTotalDaysFromTopBar();
        }

        const totalDaysNode = document.getElementById("s-total-days-count");
        if (totalDaysNode == null) { return; } // Element has not yet been added, cannot update

        totalDaysNode.textContent = game.global.stats.days;
    }

    function addTotalDaysToTopBar() {
        const nodeId = 's-total-days';
        if (document.getElementById(nodeId) !== null) { return; } // We've already added the info to the top bar

        const calendarNode = $("#topBar .calendar");
        if (calendarNode.length === 0) { return; } // The node that we want to add it to doesn't exist yet

        calendarNode.find('.day').after($(`<span id="s-total-days" class="has-text-warning" style="padding-left: 3px;">(<span id="s-total-days-count"></span>)</span>`));
    }

    function removeTotalDaysFromTopBar() {
        let totalDaysNode = document.getElementById("s-total-days");
        if (totalDaysNode == null) { return; } // Element has not yet been added, nothing to do

        totalDaysNode.remove();
    }

    function updateUI() {
        let resetScrollPositionRequired = false;
        let currentScrollPosition = document.documentElement.scrollTop || document.body.scrollTop;

        createOptionsModal();
        updateOptionsUI();
        updatePrestigeInTopBar();

        let scriptNode = $('#autoScriptContainer');
        if (scriptNode.length === 0) {
            resetScrollPositionRequired = true;
            $('#resources').append(`
              <div id="autoScriptContainer" style="margin-top: 10px;">
                <h3 id="toggleSettingsCollapsed" class="script-collapsible text-center has-text-success">Automation</h3>
                <div id="scriptToggles">
                  <label>More script options available in Settings tab<br>${overrideKeyLabel}+click options to open <span class="inactive-row">advanced configuration</span></label><br>
                </div>
              </div>`);

            let collapsibleNode = $('#toggleSettingsCollapsed');
            let togglesNode = $('#scriptToggles');

            collapsibleNode.toggleClass('script-contentactive', !settingsRaw["toggleSettingsCollapsed"]);
            togglesNode.css('display', settingsRaw["toggleSettingsCollapsed"] ? 'none' : 'block');

            collapsibleNode.on('click', function() {
                settingsRaw["toggleSettingsCollapsed"] = !settingsRaw["toggleSettingsCollapsed"];
                collapsibleNode.toggleClass('script-contentactive', !settingsRaw["toggleSettingsCollapsed"]);
                togglesNode.css('display', settingsRaw["toggleSettingsCollapsed"] ? 'none' : 'block');
                updateSettingsFromState();
            });

            createSettingToggle(togglesNode, 'masterScriptToggle', 'Stop taking any actions on behalf of the player.');

            // Dirty performance patch. Settings have a lot of elements, and they stress JQuery selectors way too much. This toggle allow to remove them from DOM completely, when they aren't needed.
            // It doesn't have huge impact anymore, after all script and game changes, but still won't hurt to have an option to increase performance a tiny bit more
            createSettingToggle(togglesNode, 'showSettings', 'You can disable rendering of settings UI once you\'ve done with configuring script, if you experiencing performance issues. It can help a little.', buildScriptSettings, removeScriptSettings);

            createSettingToggle(togglesNode, 'autoPrestige', 'Allows script to finish current run after reaching configured goal. Prestige Type is recommended to be set even with manual resetting, as script uses that to make various decisions such as picking theology techs, or skipping buildings leading in wrong direction.');
            createSettingToggle(togglesNode, 'autoEvolution', 'Runs through the evolution part of the game through to founding a settlement. In Auto Achievements mode will target races that you don\'t have extinction\\greatness achievements for yet.');
            createSettingToggle(togglesNode, 'autoFight', 'Manage spies, and sends troops to battle whenever Soldiers are full and there are no wounded. Adds to your offensive battalion and switches attack type when offensive rating is greater than the rating cutoff for that attack type. Will not manage spies when Spy Operator governor task is active.');
            createSettingToggle(togglesNode, 'autoHell', 'Sends soldiers to hell and sends them out on patrols. Adjusts maximum number of powered attractors based on threat.');
            createSettingToggle(togglesNode, 'autoMech', 'Builds most effective large mechs for current spire floor. Least effective will be scrapped to make room for new ones. Will not build or scrap anything when Mech Constructor governor task is active.', createMechInfo, removeMechInfo);
            createSettingToggle(togglesNode, 'autoFleet', 'Manages Andromeda fleet to supress piracy');
            createSettingToggle(togglesNode, 'autoTax', 'Adjusts tax rates if your current morale is greater than your maximum allowed morale. Will always keep morale above 100%. Disabled when Tax-Morale Balance governor task is active.');
            createSettingToggle(togglesNode, 'autoGovernment', 'Manage changes of government and governor when they becomes available. Governor will be selected once, and won\'t be reassigned, unless manually fired.');
            createSettingToggle(togglesNode, 'autoCraft', 'Automatically produce craftable resources, thresholds when it happens depends on current demands and stocks.', createCraftToggles, removeCraftToggles);
            createSettingToggle(togglesNode, 'autoTrigger', 'Purchase triggered buildings, projects, and researches once conditions met');
            createSettingToggle(togglesNode, 'autoBuild', 'Construct buildings based on their weightings(user configured), and various rules(e.g. it won\'t build building which have no support to run)', createBuildingToggles, removeBuildingToggles);
            createSettingToggle(togglesNode, 'autoARPA', 'Builds ARPA projects if user enables them to be built.', createArpaToggles, removeArpaToggles);
            createSettingToggle(togglesNode, 'autoPower', 'Manages power based on a priority order of buildings. Also disables currently useless buildings to save up resources.');
            createSettingToggle(togglesNode, 'autoStorage', 'Assigns crates and containers to resources needed for buildings enabled for Auto Build, queued buildings, researches, and enabled projects. Disabled when Crate/Container Manager governor task is active.', createStorageToggles, removeStorageToggles);
            createSettingToggle(togglesNode, 'autoMarket', 'Allows for automatic buying and selling of resources once specific ratios are met. Also allows setting up trade routes until a minimum specified money per second is reached. The will trade in and out in an attempt to maximize your trade routes.', createMarketToggles, removeMarketToggles);
            createSettingToggle(togglesNode, 'autoGalaxyMarket', 'Manages galaxy trade routes');
            createSettingToggle(togglesNode, 'autoResearch', 'Performs research when minimum requirements are met.');
            createSettingToggle(togglesNode, 'autoJobs', 'Assigns jobs in a priority order with multiple breakpoints. Starts with a few jobs each and works up from there. Will try to put a minimum number on lumber / stone then fill up capped jobs first.');
            createSettingToggle(togglesNode, 'autoCraftsmen', 'Manage foundry workers, switching between resources at given ratio.');
            createSettingToggle(togglesNode, 'autoAlchemy', 'Manages alchemic transmutations');
            createSettingToggle(togglesNode, 'autoPylon', 'Manages pylon rituals');
            createSettingToggle(togglesNode, 'autoQuarry', 'Manages rock quarry stone to chrysotile ratio for smoldering races');
            createSettingToggle(togglesNode, 'autoMine', 'Manages titan mine aluminium to adamantite ratio in true path');
            createSettingToggle(togglesNode, 'autoExtractor', 'Manages extractor ship mining ratios in true path');
            createSettingToggle(togglesNode, 'autoSmelter', 'Manages smelter fuel and production.');
            createSettingToggle(togglesNode, 'autoFactory', 'Manages factory production.');
            createSettingToggle(togglesNode, 'autoMiningDroid', 'Manages mining droid production.');
            createSettingToggle(togglesNode, 'autoGraphenePlant', 'Manages graphene plant. Not user configurable - just uses least demanded resource for fuel.');
            createSettingToggle(togglesNode, 'autoGenetics', 'Managed genetics settings, and automatically assembles genes more optimally than ingame sequencer');
            createSettingToggle(togglesNode, 'autoMinorTrait', 'Purchase minor traits using genes according to their weighting settings. Also manages Mimic genus, and Psychic powers.');
            createSettingToggle(togglesNode, 'autoMutateTraits', 'Mutate in or out major and genus traits. WARNING: This will spend spend Plasmids and Anti-Plasmids.');
            createSettingToggle(togglesNode, 'autoEject', 'Eject excess resources to black hole. Normal resources ejected when they close to storage cap, craftables - when above requirements. Disabled when Mass Ejector Optimizer governor task is active.', createEjectToggles, removeEjectToggles);
            createSettingToggle(togglesNode, 'autoSupply', 'Send excess resources to Spire. Normal resources sent when they close to storage cap, craftables - when above requirements. Takes priority over ejector.', createSupplyToggles, removeSupplyToggles);
            createSettingToggle(togglesNode, 'autoNanite', 'Consume resources to produce Nanite. Normal resources sent when they close to storage cap, craftables - when above requirements. Takes priority over supplies and ejector.');
            createSettingToggle(togglesNode, 'autoReplicator', 'Use excess power to replicate resources.');

            createQuickOptions(togglesNode, "s-quick-prestige-options", "Prestige", buildPrestigeSettings);

            togglesNode.append('<a class="button is-dark is-small" id="bulk-sell"><span>Bulk Sell</span></a>');
            $("#bulk-sell").on('mouseup', function() {
                updateDebugData();
                updateScriptData();
                finalizeScriptData();
                autoMarket(true, true);
            });
        }

        if (scriptNode.next().length) {
            resetScrollPositionRequired = true;
            scriptNode.parent().append(scriptNode);
        }

        if (settingsRaw.showSettings && $("#script_settings").length === 0) {
            buildScriptSettings();
        }
        if (settingsRaw.autoCraft && $('#resources .ea-craft-toggle').length === 0) {
            createCraftToggles();
        }
        // Building toggles added to different tabs, game can redraw just one tab, destroying toggles there, and we still have total number of toggles above zero; we'll remember amount of toggle, and redraw it when number differ from what we have in game
        if (settingsRaw.autoBuild) {
            let currentBuildingToggles = $('#mTabCivil .ea-building-toggle').length;
            if (currentBuildingToggles === 0 || currentBuildingToggles !== state.buildingToggles) {
                createBuildingToggles();
            }
        }
        if (settingsRaw.autoStorage && game.global.settings.showStorage && $('#resStorage .ea-storage-toggle').length === 0) {
            createStorageToggles();
        }
        if (settingsRaw.autoMarket && game.global.settings.showMarket && $('#market .ea-market-toggle').length === 0) {
            createMarketToggles();
        }
        if (settingsRaw.autoEject && game.global.settings.showEjector && $('#resEjector .ea-eject-toggle').length === 0) {
            createEjectToggles();
        }
        if (settingsRaw.autoSupply && game.global.settings.showCargo && $('#resCargo .ea-supply-toggle').length === 0) {
            createSupplyToggles();
        }
        if (settingsRaw.autoARPA && game.global.settings.showGenetics && $('#arpaPhysics .ea-arpa-toggle').length === 0) {
            createArpaToggles();
        }

        if (settingsRaw.autoMech && game.global.settings.showMechLab && $('#mechList .ea-mech-info').length < $('#mechList .mechRow').length) {
            createMechInfo();
        }

        // Hell messages
        if (settings.hellTurnOffLogMessages) {
            if (game.global.portal.fortress?.notify === "Yes") {
                $("#fort .b-checkbox").eq(0).click();
            }
            if (game.global.portal.fortress?.s_ntfy === "Yes") {
                $("#fort .b-checkbox").eq(1).click();
            }
        }

        // Soul Gems income rate
        if (resources.Soul_Gem.isUnlocked()) {
            let currentSec = Math.floor(state.scriptTick / 4);
            if (resources.Soul_Gem.currentQuantity > state.soulGemLast) {
                state.soulGemIncomes.push({sec: currentSec, gems: resources.Soul_Gem.currentQuantity - state.soulGemLast})
                state.soulGemLast = resources.Soul_Gem.currentQuantity;
            }
            let gems = 0;
            let i = state.soulGemIncomes.length;
            while (--i >= 0) {
                let income = state.soulGemIncomes[i];
                // Get all gems gained in last hour, or at least 10 last gems in any time frame, if rate is low
                if (currentSec - income.sec > 3600 && gems > 10) {
                    break;
                } else {
                    gems += income.gems;
                }
            }
            // If loop was broken prematurely - clean up old records which we don't need anymore
            if (i >= 0) {
                state.soulGemIncomes = state.soulGemIncomes.splice(i+1);
            }
            let timePassed = currentSec - state.soulGemIncomes[0].sec;
            let gph = gems / timePassed * 3600;
            state.soulGemPerHour = gph;
            if (gph >= 1000) { gph = Math.round(gph); }
            $("#resSoul_Gem span:eq(2)").text(`${gems > 0 && currentSec <= 3600 ? '~' : ''}${getNiceNumber(gph)} /h`);
        }

        // Previous game stats
        if ($("#statsPanel .cstat").length === 1) {
            let backupString = win.LZString.decompressFromUTF16(localStorage.getItem('evolveBak'));
            if (backupString) {
                let oldStats = JSON.parse(backupString).stats;
                let statsData = {knowledge_spent: oldStats.know, starved_to_death: oldStats.starved, died_in_combat: oldStats.died, attacks_made: oldStats.attacks, game_days_played: oldStats.days};
                if (oldStats.dkills > 0) {
                    statsData.demons_kills = oldStats.dkills;
                }
                if (oldStats.sac > 0) {
                    statsData.sacrificed = oldStats.sac;
                }
                if (oldStats.murders > 0) {
                    statsData.murders = oldStats.murders;
                }
                if (oldStats.psykill > 0) {
                    statsData.psymurders = oldStats.psykill;
                }
                let statsString = `<div class="cstat"><span class="has-text-success">Previous Game</span></div>`;
                for (let [label, value] of Object.entries(statsData)) {
                    statsString += `<div><span class="has-text-warning">${game.loc("achieve_stats_" + label)}</span> ${value.toLocaleString()}</div>`;
                }
                $("#statsPanel").append(statsString);
            }
        }

        if (resetScrollPositionRequired) {
            // Leave the scroll position where it was before all our updates to the UI above
            document.documentElement.scrollTop = document.body.scrollTop = currentScrollPosition;
        }

        updateTotalDaysInTopBar();
    }

    function createMechInfo() {
        if ($(`#mechList .mechRow[draggable=true]`).length > 0) {
            return;
        }
        if (MechManager.isActive || MechManager.initLab()) {
            MechManager.mechObserver.disconnect();
            let list = getVueById("mechList");
            for (let i = 0; i < list._vnode.children.length; i++) {
                let mech = game.global.portal.mechbay.mechs[i];
                let stats = MechManager.getMechStats(mech);
                let rating = stats.power / MechManager.bestMech[mech.size].power;
                let info = (mech.size === 'collector' ?
                  `${Math.round(rating*100)}%, ${getNiceNumber(stats.power*MechManager.collectorValue)} /s`:
                  `${Math.round(rating*100)}%, ${getNiceNumber(stats.power*100)}, ${getNiceNumber(stats.efficiency*100)}`)
                  + " | ";

                let mechNode = list._vnode.children[i].elm;
                let firstNode = $(mechNode.childNodes[0]);
                if (firstNode.hasClass("ea-mech-info")) {
                    firstNode.text(info);
                } else {
                    let note = document.createElement("span");
                    note.className = "ea-mech-info";
                    note.innerHTML = info;
                    mechNode.insertBefore(note, mechNode.firstChild);
                }
            }
            MechManager.mechObserver.observe(document.getElementById("mechList"), {childList: true});
        }
    }

    function removeMechInfo() {
        MechManager.mechObserver.disconnect();
        $('#mechList .ea-mech-info').remove();
    }

    function createArpaToggles() {
        removeArpaToggles();

        for (let i = 0; i < ProjectManager.priorityList.length; i++) {
            let project = ProjectManager.priorityList[i];
            let projectElement = $('#arpa' + project.id + ' .head');
            if (projectElement.length) {
                let settingKey = "arpa_" + project.id;
                projectElement.append(addToggleCallbacks($(`
                  <label tabindex="0" class="switch ea-arpa-toggle" style="position:relative; max-width:75px; margin-top:-36px; left:59%; float:left;">
                    <input class="script_${settingKey}" type="checkbox"${settingsRaw[settingKey] ? " checked" : ""}>
                    <span class="check" style="height:5px;"></span>
                  </label>`), settingKey));
            }
        }
    }

    function removeArpaToggles() {
        $('#arpaPhysics .ea-arpa-toggle').remove();
    }

    function createCraftToggles() {
        removeCraftToggles();

        for (let i = 0; i < craftablesList.length; i++) {
            let craftable = craftablesList[i];
            let craftableElement = $('#res' + craftable.id + ' h3');
            if (craftableElement.length) {
                let settingKey = "craft" + craftable.id;
                craftableElement.prepend(addToggleCallbacks($(`
                  <label tabindex="0" class="switch ea-craft-toggle">
                    <input class="script_${settingKey}" type="checkbox"${settingsRaw[settingKey] ? " checked" : ""}/>
                    <span class="check" style="height:5px;"></span>
                  </label>`), settingKey));
            }
        }
    }

    function removeCraftToggles() {
        $('#resources .ea-craft-toggle').remove();
    }

    function createBuildingToggles() {
        removeBuildingToggles();

        for (let i = 0; i < BuildingManager.priorityList.length; i++) {
            let building = BuildingManager.priorityList[i];
            let buildingElement = $('#' + building._vueBinding);
            if (buildingElement.length) {
                let settingKey = "bat" + building._vueBinding;
                buildingElement.append(addToggleCallbacks($(`
                  <label tabindex="0" class="switch ea-building-toggle" style="position:absolute; margin-top: 24px; left:10%;">
                    <input class="script_${settingKey}" type="checkbox"${settingsRaw[settingKey] ? " checked" : ""}/>
                    <span class="check" style="height:5px; max-width:15px"></span>
                  </label>`), settingKey));
                state.buildingToggles++;
            }
        }
    }

    function removeBuildingToggles() {
        $('#mTabCivil .ea-building-toggle').remove();
        state.buildingToggles = 0;
    }

    function createEjectToggles() {
        removeEjectToggles();

        $('#eject').append('<span id="script_eject_top_row" style="margin-left: auto; margin-right: 0.2rem; float: right;" class="has-text-danger">Auto Eject</span>');
        for (let resource of EjectManager.priorityList) {
            let ejectElement = $('#eject' + resource.id);
            if (ejectElement.length) {
                let settingKey = 'res_eject' + resource.id;
                ejectElement.append(addToggleCallbacks($(`
                  <label tabindex="0" title="Enable ejecting of this resource. When to eject is set in the Prestige Settings tab." class="switch ea-eject-toggle" style="margin-left:auto; margin-right:0.2rem;">
                    <input class="script_${settingKey}" type="checkbox"${settingsRaw[settingKey] ? " checked" : ""}>
                    <span class="check" style="height:5px;"></span>
                    <span class="state"></span>
                  </label>`), settingKey));
            }
        }
    }

    function removeEjectToggles() {
        $('#resEjector .ea-eject-toggle').remove();
        $("#script_eject_top_row").remove();
    }

    function createSupplyToggles() {
        removeSupplyToggles();

        $('#spireSupply').append('<span id="script_supply_top_row" style="margin-left: auto; margin-right: 0.2rem; float: right;" class="has-text-danger">Auto Supply</span>');
        for (let resource of SupplyManager.priorityList) {
            let supplyElement = $('#supply' + resource.id);
            if (supplyElement.length) {
                let settingKey = 'res_supply' + resource.id;
                supplyElement.append(addToggleCallbacks($(`
                  <label tabindex="0" title="Enable supply of this resource."  class="switch ea-supply-toggle" style="margin-left:auto; margin-right:0.2rem;">
                    <input class="script_${settingKey}" type="checkbox"${settingsRaw[settingKey] ? " checked" : ""}>
                    <span class="check" style="height:5px;"></span>
                    <span class="state"></span>
                  </label>`), settingKey));
            }
        }
    }

    function removeSupplyToggles() {
        $('#resCargo .ea-supply-toggle').remove();
        $("#script_supply_top_row").remove();
    }

    function createMarketToggles() {
        removeMarketToggles();

        if (!game.global.race['no_trade']) {
            $("#market .market-item[id] .res").width("5rem");
            $("#market .market-item[id] .buy span").text("B");
            $("#market .market-item[id] .sell span").text("S");
            $("#market .market-item[id] .trade > :first-child").text("R");
            $("#market .market-item[id] .trade .zero").text("×");
        }

        $("#market-qty").after(`
          <div class="market-item vb" id="script_market_top_row" style="overflow:hidden">
            <span style="margin-left: auto; margin-right: 0.2rem; float:right;">
              ${!game.global.race['no_trade']?`
              <span class="has-text-success" style="width: 2.75rem; margin-right: 0.3em; display: inline-block; text-align: center;">Buy</span>
              <span class="has-text-danger" style="width: 2.75rem; margin-right: 0.3em; display: inline-block; text-align: center;">Sell</span>`:''}
              <span class="has-text-warning" style="width: 2.75rem; margin-right: 0.3em; display: inline-block; text-align: center;">In</span>
              <span class="has-text-warning" style="width: 2.75rem; display: inline-block; text-align: center;">Away</span>
            </span>
          </div>`);

        for (let resource of MarketManager.priorityList) {
            if (resource === resources.Food && game.global.race['artifical']) {
                continue;
            }
            let marketElement = $('#market-' + resource.id);
            if (marketElement.length > 0) {
                let marketRow = $('<span class="ea-market-toggle" style="margin-left: auto; margin-right: 0.2rem; float:right;"></span>');

                if (!game.global.race['no_trade']) {
                    let buyKey = 'buy' + resource.id;
                    let sellKey = 'sell' + resource.id;
                    marketRow.append(
                      addToggleCallbacks($(`<label tabindex="0" title="Enable buying of this resource." class="switch"><input class="script_${buyKey}" type="checkbox"${settingsRaw[buyKey] ? " checked" : ""}><span class="check" style="height:5px;"></span><span class="state"></span></label>`), buyKey),
                      addToggleCallbacks($(`<label tabindex="0" title="Enable selling of this resource." class="switch"><input class="script_${sellKey}" type="checkbox"${settingsRaw[sellKey] ? " checked" : ""}><span class="check" style="height:5px;"></span><span class="state"></span></label>`), sellKey));
                }

                let tradeBuyKey = 'res_trade_buy_' + resource.id;
                let tradeSellKey = 'res_trade_sell_' + resource.id;
                marketRow.append(
                  addToggleCallbacks($(`<label tabindex="0" title="Enable trading for this resource." class="switch"><input class="script_${tradeBuyKey}" type="checkbox"${settingsRaw[tradeBuyKey] ? " checked" : ""}><span class="check" style="height:5px;"></span><span class="state"></span></label>`), tradeBuyKey),
                  addToggleCallbacks($(`<label tabindex="0" title="Enable trading this resource away." class="switch"><input class="script_${tradeSellKey}" type="checkbox"${settingsRaw[tradeSellKey] ? " checked" : ""}><span class="check" style="height:5px;"></span><span class="state"></span></label>`), tradeSellKey));

                marketRow.appendTo(marketElement);
            }
        }
    }

    function removeMarketToggles() {
        $('#market .ea-market-toggle').remove();
        $("#script_market_top_row").remove();

        if (!game.global.race['no_trade']) {
            $("#market .market-item[id] .res").width("7.5rem");
            $("#market .market-item[id] .buy span").text(game.loc('resource_market_buy'));
            $("#market .market-item[id] .sell span").text(game.loc('resource_market_sell'));
            $("#market .market-item[id] .trade > :first-child").text(game.loc('resource_market_routes'));
            $("#market .market-item[id] .trade .zero").text(game.loc('cancel_routes'));
        }
    }

    function createStorageToggles() {
        removeStorageToggles();

        $("#createHead").after(`
          <div class="market-item vb" id="script_storage_top_row" style="overflow:hidden">
            <span style="margin-left: auto; margin-right: 0.2rem; float:right;">
              <span class="has-text-warning" style="width: 2.75rem; margin-right: 0.3em; display: inline-block; text-align: center;">Auto</span>
              <span class="has-text-warning" style="width: 2.75rem; display: inline-block; text-align: center;">Over</span>
            </span>
          </div>`);

        for (let resource of StorageManager.priorityList) {
            let storageElement = $('#stack-' + resource.id);
            if (storageElement.length > 0) {
                let storeKey = "res_storage" + resource.id;
                let overKey = "res_storage_o_" + resource.id;
                $(`<span class="ea-storage-toggle" style="margin-left: auto; margin-right: 0.2rem; float:right;"></span>`)
                  .append(
                    addToggleCallbacks($(`<label tabindex="0" title="Enable storing of this resource." class="switch"><input class="script_${storeKey}" type="checkbox"${settingsRaw[storeKey] ? " checked" : ""}><span class="check" style="height:5px;"></span><span class="state"></span></label>`), storeKey),
                    addToggleCallbacks($(`<label tabindex="0" title="Enable storing overflow of this resource." class="switch"><input class="script_${overKey}" type="checkbox"${settingsRaw[overKey] ? " checked" : ""}><span class="check" style="height:5px;"></span><span class="state"></span></label>`), overKey))
                  .appendTo(storageElement);
            }
        }
    }

    function removeStorageToggles() {
        $('#resStorage .ea-storage-toggle').remove();
        $("#script_storage_top_row").remove();
    }

    function sorterHelper(event, ui) {
        let clone = $(ui).clone();
        clone.css('position','absolute');
        return clone.get(0);
    }

    // Util functions
    // https://gist.github.com/axelpale/3118596
    function k_combinations(set, k) {
        if (k > set.length || k <= 0) {
            return [[]];
        }
        if (k == set.length) {
            return [set];
        }
        if (k == 1) {
            return set.map(i => [i]);
        }
        let combs = [];
        let tailcombs = [];
        for (let i = 0; i < set.length - k + 1; i++) {
            tailcombs = k_combinations(set.slice(i + 1), k - 1);
            for (let j = 0; j < tailcombs.length; j++) {
                combs.push([set[i], ...tailcombs[j]])
            }
        }
        return combs;
    }

    // https://stackoverflow.com/a/44012184
    function* cartesian(head, ...tail) {
        let remainder = tail.length > 0 ? cartesian(...tail) : [[]];
        for (let r of remainder) for (let h of head) yield [h, ...r];
    }

    function average(arr) {
        return arr.reduce((sum, val) => sum + val) / arr.length;
    }

    // Script hooked to fastTick fired 4 times per second
    function ticksPerSecond() {
        return 4 / settings.tickRate / (game.global.settings.at ? 2 : 1);
    }

    // main.js -> Soldier Healing
    function getHealingRate() {
        let hc = 
          (game.global.race['orbit_decayed'] && game.global.race['truepath']) ? buildings.EnceladusBase.stateOnCount :
          game.global.race['artifical'] ? buildings.BootCamp.count :
          buildings.Hospital.count;
        if (game.global.race['rejuvenated'] && game.global.stats.achieve['lamentis']){
            hc += Math.min(game.global.stats.achieve.lamentis.l, 5);
        }
        hc *= (state.astroSign === 'cancer' ? 1.05 : 1);
        hc *= game.global.tech['medic'] || 1;
        hc += (game.global.race['fibroblast'] * 2) || 0;
        if (game.global.city.s_alter?.regen > 0){
            if (hc >= 20) {
                hc *= traitVal("cannibalize", 0, '+');
            } else {
                hc += Math.floor(traitVal("cannibalize", 0) / 5);
            }
        }
        hc *= traitVal("high_pop", 2, 1);
        if (getGovernor() === 'sports') {
            hc *= 1.5;
        }
        let max_bound = 20 * traitVal('slow_regen', 0, '+');

        return traitVal('regenerative', 0, 1) + Math.round(hc) / max_bound;
    }

    // main.js -> Citizen Growth
    function getGrowthRate() {
        if (game.global.race['artifical'] || (game.global.race['spongy'] && game.global.city.calendar.weather === 0) ||
           (game.global.race['parasite'] && game.global.city.calendar.wind === 0 && !game.global.race['cataclysm'])) {
            return 0;
        }
        let date = new Date();
        let lb = game.global.tech['reproduction'] ?? 0;
        if (haveTech('reproduction') && date.getMonth() === 1 && date.getDate() === 14) {
            lb += 5;
        }
        lb *= traitVal('fast_growth', 0, 1);
        lb += traitVal('fast_growth', 1, 0);
        if (game.global.race['spores'] && game.global.city.calendar.wind === 1){
            if (game.global.race['parasite']) {
                lb += traitVal('spores', 2);
            } else {
                lb += traitVal('spores', 0);
                lb *= traitVal('spores', 1);
            }
        }
        lb += buildings.Hospital.count * (haveTech('reproduction', 2) ? 1 : 0);
        lb += game.global.genes['birth'] ?? 0;
        lb += game.global.race['promiscuous'] ?? 0;
        lb *= (state.astroSign === 'sagittarius' ? 1.25 : 1);
        lb *= traitVal("high_pop", 2, 1);
        lb *= (game.global.city.biome === 'taiga' ? 1.5 : 1);
        let base = resources.Population.currentQuantity * (game.global.city.ptrait.includes('toxic') ? 1.25 : 1);
        if (game.global.race['parasite'] && game.global.race['cataclysm']){
            lb = Math.round(lb / 5);
            base *= 3;
        }
        return lb / (base * 1.810792884997279 / 2);
    }

    function getResourcesPerClick() {
        return traitVal('strong', 0, 1) * (game.global.genes['enhance'] ? 2 : 1);
    }

    function getCostConflict(action) {
        let conflict = {};

        for (let priorityTarget of state.conflictTargets) {
            let blockKnowledge = true;
            for (let res in priorityTarget.cost) {
                if (res !== "Knowledge" && resources[res].currentQuantity < priorityTarget.cost[res]) {
                    blockKnowledge = false;
                    break;
                }
            }
            for (let res in priorityTarget.cost) {
                if ((res !== "Knowledge" || blockKnowledge) && priorityTarget.cost[res] > resources[res].currentQuantity - action.cost[res]) {
                    const resList = conflict.resList || [];
                    const actionList = conflict.actionList || [];
                    conflict = {res: resources[res], obj: priorityTarget, resList: [...new Set([...resList, res])], actionList: [...new Set([...actionList, priorityTarget.name])]};
                }
            }
        }
        return $.isEmptyObject(conflict) ? null : conflict;
    }

    function getRealNumber(amountText) {
        if (amountText === "") { return 0; }

        let numericPortion = parseFloat(amountText);
        let lastChar = amountText[amountText.length - 1];

        if (numberSuffix[lastChar] !== undefined) {
            numericPortion *= numberSuffix[lastChar];
        }

        return numericPortion;
    }

    function getNumberString(amountValue) {
        let suffixes = Object.keys(numberSuffix);
        for (let i = suffixes.length - 1; i >= 0; i--) {
            if (amountValue > numberSuffix[suffixes[i]]) {
                return (amountValue / numberSuffix[suffixes[i]]).toFixed(1) + suffixes[i];
            }
        }
        return Math.ceil(amountValue);
    }

    function getNiceNumber(amountValue) {
        return parseFloat(amountValue < 1 ? amountValue.toPrecision(2) : amountValue.toFixed(2));
    }

    function getGovernor() {
        return game.global.race.governor?.g?.bg ?? "none";
    }

    function haveTask(task) {
        return Object.values(game.global.race.governor?.tasks ?? {}).includes(task);
    }

    function haveTech(research, level = 1) {
        return game.global.tech[research] && game.global.tech[research] >= level;
    }

    function isEarlyGame() {
        if (game.global.race['cataclysm'] || game.global.race['orbit_decayed'] || game.global.race['lone_survivor']) {
            return false;
        } else if (game.global.race['truepath'] || game.global.race['sludge']) {
            return !haveTech("high_tech", 7);
        } else {
            return !haveTech("mad");
        }
    }

    function isHungryRace() {
        return (game.global.race['carnivore'] && !game.global.race['herbivore'] && !game.global.race['artifical']) || game.global.race['ravenous'];
    }

    function isDemonRace() {
        return game.global.race['soul_eater'] && game.global.race['evil'] && game.global.race.species !== 'wendigo';
    }

    function isLumberRace() {
        return !game.global.race['kindling_kindred'] && !game.global.race['smoldering'];
    }

    function getOccCosts() {
        return traitVal('high_pop', 0, 1) * (game.global.civic.govern.type === "federation" ? 15 : 20);
    }

    function getGovName(govIndex) {
        let foreign = game.global.civic.foreign["gov" + govIndex];
        if (!foreign.name) {
            return "foreign power " + (govIndex + 1);
        }

        return poly.loc("civics_gov" + foreign.name.s0, [foreign.name.s1]) + ` (${govIndex + 1})`;
    }

    function getGovPower(govIndex) {
        // This function is full of hacks. But all that can be accomplished by wise player without peeking inside game variables
        // We really need to know power as accurate as possible, otherwise script becomes wonky when spies dies on mission
        let gov = game.global.civic.foreign["gov" + govIndex];
        if (gov.spy > 0) {
            // With 2+ spies we know exact number, for 1 we're assuming trick with advantage
            // We can see ambush advantage with a single spy, and knowing advantage we can calculate power
            // Proof of concept: military_power = army_offence / (5 / (1-advantage))
            // I'm not going to waste time parsing tooltips, and take that from internal variable instead
            return gov.mil;
        } else {
            // We're going to use another trick here. We know minimum and maximum power for gov
            // If current power is below minimum, that means we sabotaged it already, but spy died since that
            // We know we seen it for sure, so let's just peek inside, imitating memory
            // We could cache those values, but making it persistent in between of page reloads would be a pain
            // Especially considering that player can not only reset, but also import different save at any moment
            let minPower = [75, 125, 200, 650, 300];
            let maxPower = [125, 175, 300, 750, 300];
            if (game.global.race['truepath']) {
                [1.5, 1.4, 1.25].forEach((mod, idx) => {
                    minPower[idx] *= mod;
                    maxPower[idx] *= mod;
                });
            }

            if (gov.mil < minPower[govIndex]) {
                return gov.mil;
            } else {
                // Above minimum. Even if we ever sabotaged it, unfortunately we can't prove it. Not peeking inside, and assuming worst.
                return maxPower[govIndex];
            }
        }
    }

    var evalCache = {};
    function fastEval(s) {
        if (!evalCache[s]) {
            evalCache[s] = eval(`(function() { return ${s} })`);
        }
        return evalCache[s]();
    }

    function getVueById(elementId) {
        let element = win.document.getElementById(elementId);
        if (element === null || !element.__vue__) {
            return undefined;
        }

        return element.__vue__;
    }

    // Recursively traverse through object, wrapping all functions in getters
    function normalizeProperties(object, proto = []) {
        for (let key in object) {
            if (typeof object[key] === "object" && (object[key].constructor === Object || object[key].constructor === Array || proto.indexOf(object[key].constructor) !== -1)) {
                object[key] = normalizeProperties(object[key], proto);
            }
            if (typeof object[key] === "function") {
                let fn = object[key].bind(object);
                Object.defineProperty(object, key, {configurable: true, enumerable: true, get: () => fn()});
            }
        }
        return object;
    }

    // Add getters for setting properties
    function addProps(list, id, props) {
        for (let item of Object.values(list)) {
            for (let i = 0; i < props.length; i++) {
                let settingKey = props[i].s + id(item);
                let propertyKey = props[i].p;
                Object.defineProperty(item, propertyKey, {configurable: true, enumerable: true, get: () => settings[settingKey]});
            }
        }
        return list;
    }

    function traitVal(trait, idx, opt) {
        if (game.global.race[trait]) {
            let val = game.traits[trait].vars()[idx];
            if (opt === "-") {
                return 1 - val / 100;
            } else if (opt === "+") {
                return 1 + val / 100;
            } else if (opt === "=") {
                return val / 100;
            } else {
                return val;
            }
        } else if (opt === '+' || opt === '-' || opt === '=') {
            return 1;
        } else {
            return opt ?? 0;
        }
    }

    var poly = {
    // Taken directly from game code with no functional changes, and minified.
        // export function astrologySign() from seasons.js
        astrologySign: function(){let t=new Date;if(0===t.getMonth()&&t.getDate()>=20||1===t.getMonth()&&18>=t.getDate())return"aquarius";if(1===t.getMonth()&&t.getDate()>=19||2===t.getMonth()&&20>=t.getDate())return"pisces";if(2===t.getMonth()&&t.getDate()>=21||3===t.getMonth()&&19>=t.getDate())return"aries";if(3===t.getMonth()&&t.getDate()>=20||4===t.getMonth()&&20>=t.getDate())return"taurus";if(4===t.getMonth()&&t.getDate()>=21||5===t.getMonth()&&21>=t.getDate())return"gemini";else if(5===t.getMonth()&&t.getDate()>=22||6===t.getMonth()&&22>=t.getDate())return"cancer";else if(6===t.getMonth()&&t.getDate()>=23||7===t.getMonth()&&22>=t.getDate())return"leo";else if(7===t.getMonth()&&t.getDate()>=23||8===t.getMonth()&&22>=t.getDate())return"virgo";else if(8===t.getMonth()&&t.getDate()>=23||9===t.getMonth()&&22>=t.getDate())return"libra";else if(9===t.getMonth()&&t.getDate()>=23||10===t.getMonth()&&22>=t.getDate())return"scorpio";else if(10===t.getMonth()&&t.getDate()>=23||11===t.getMonth()&&21>=t.getDate())return"sagittarius";else if(11===t.getMonth()&&t.getDate()>=22||0===t.getMonth()&&19>=t.getDate())return"capricorn";else return"time itself is broken"},
        // export function arpaAdjustCosts(costs) from arpa.js
        arpaAdjustCosts: function(t){return t=function(t){var r=traitVal('creative',1,'-');if(r<1){var a={};return Object.keys(t).forEach(function(e){a[e]=function(){return t[e]()*r}}),a}return t}(t),poly.adjustCosts({cost:t})},
        // function govPrice(gov) from civics.js
        govPrice: function(e){let o=game.global.civic.foreign[`gov${e}`],i=15384*o.eco;return i*=1+1.6*o.hstl/100,+(i*=1-.25*o.unrest/100).toFixed(0)},
        // export const galaxyOffers from resources.js
        galaxyOffers: normalizeProperties([{buy:{res:"Deuterium",vol:5},sell:{res:"Helium_3",vol:25}},{buy:{res:"Neutronium",vol:2.5},sell:{res:"Copper",vol:200}},{buy:{res:"Adamantite",vol:3},sell:{res:"Iron",vol:300}},{buy:{res:"Elerium",vol:1},sell:{res:"Oil",vol:125}},{buy:{res:"Nano_Tube",vol:10},sell:{res:"Titanium",vol:20}},{buy:{res:"Graphene",vol:25},sell:{res:()=>game.global.race.kindling_kindred||game.global.race.smoldering?game.global.race.smoldering?"Chrysotile":"Stone":"Lumber",vol:1e3}},{buy:{res:"Stanene",vol:40},sell:{res:"Aluminium",vol:800}},{buy:{res:"Bolognium",vol:.75},sell:{res:"Uranium",vol:4}},{buy:{res:"Vitreloy",vol:1},sell:{res:"Infernite",vol:1}}]),
        // export const supplyValue from resources.js
        supplyValue: {Lumber:{in:.5,out:25e3},Chrysotile:{in:.5,out:25e3},Stone:{in:.5,out:25e3},Crystal:{in:3,out:25e3},Furs:{in:3,out:25e3},Copper:{in:1.5,out:25e3},Iron:{in:1.5,out:25e3},Aluminium:{in:2.5,out:25e3},Cement:{in:3,out:25e3},Coal:{in:1.5,out:25e3},Oil:{in:2.5,out:12e3},Uranium:{in:5,out:300},Steel:{in:3,out:25e3},Titanium:{in:3,out:25e3},Alloy:{in:6,out:25e3},Polymer:{in:6,out:25e3},Iridium:{in:8,out:25e3},Helium_3:{in:4.5,out:12e3},Deuterium:{in:4,out:1e3},Neutronium:{in:15,out:1e3},Adamantite:{in:12.5,out:1e3},Infernite:{in:25,out:250},Elerium:{in:30,out:250},Nano_Tube:{in:6.5,out:1e3},Graphene:{in:5,out:1e3},Stanene:{in:4.5,out:1e3},Bolognium:{in:18,out:1e3},Vitreloy:{in:14,out:1e3},Orichalcum:{in:10,out:1e3},Plywood:{in:10,out:250},Brick:{in:10,out:250},Wrought_Iron:{in:10,out:250},Sheet_Metal:{in:10,out:250},Mythril:{in:12.5,out:250},Aerogel:{in:16.5,out:250},Nanoweave:{in:18,out:250},Scarletite:{in:35,out:250}},
        // export const monsters from portal.js
        monsters: {fire_elm:{weapon:{laser:1.05,flame:0,plasma:.25,kinetic:.5,missile:.5,sonic:1,shotgun:.75,tesla:.65},nozone:{freeze:!0,flooded:!0},amp:{hot:1.75,humid:.8,steam:.9}},water_elm:{weapon:{laser:.65,flame:.5,plasma:1,kinetic:.2,missile:.5,sonic:.5,shotgun:.25,tesla:.75},nozone:{hot:!0,freeze:!0},amp:{steam:1.5,river:1.1,flooded:2,rain:1.75,humid:1.25}},rock_golem:{weapon:{laser:1,flame:.5,plasma:1,kinetic:.65,missile:.95,sonic:.75,shotgun:.35,tesla:0},nozone:{},amp:{}},bone_golem:{weapon:{laser:.45,flame:.35,plasma:.55,kinetic:1,missile:1,sonic:.75,shotgun:.75,tesla:.15},nozone:{},amp:{}},mech_dino:{weapon:{laser:.85,flame:.05,plasma:.55,kinetic:.45,missile:.5,sonic:.35,shotgun:.5,tesla:1},nozone:{},amp:{}},plant:{weapon:{laser:.42,flame:1,plasma:.65,kinetic:.2,missile:.25,sonic:.75,shotgun:.35,tesla:.38},nozone:{},amp:{}},crazed:{weapon:{laser:.5,flame:.85,plasma:.65,kinetic:1,missile:.35,sonic:.15,shotgun:.95,tesla:.6},nozone:{},amp:{}},minotaur:{weapon:{laser:.32,flame:.5,plasma:.82,kinetic:.44,missile:1,sonic:.15,shotgun:.2,tesla:.35},nozone:{},amp:{}},ooze:{weapon:{laser:.2,flame:.65,plasma:1,kinetic:0,missile:0,sonic:.85,shotgun:0,tesla:.15},nozone:{},amp:{}},zombie:{weapon:{laser:.35,flame:1,plasma:.45,kinetic:.08,missile:.8,sonic:.18,shotgun:.95,tesla:.05},nozone:{},amp:{}},raptor:{weapon:{laser:.68,flame:.55,plasma:.85,kinetic:1,missile:.44,sonic:.22,shotgun:.33,tesla:.66},nozone:{},amp:{}},frost_giant:{weapon:{laser:.9,flame:.82,plasma:1,kinetic:.25,missile:.08,sonic:.45,shotgun:.28,tesla:.5},nozone:{hot:!0},amp:{freeze:2.5,hail:1.65}},swarm:{weapon:{laser:.02,flame:1,plasma:.04,kinetic:.01,missile:.08,sonic:.66,shotgun:.38,tesla:.45},nozone:{},amp:{}},dragon:{weapon:{laser:.18,flame:0,plasma:.12,kinetic:.35,missile:1,sonic:.22,shotgun:.65,tesla:.15},nozone:{},amp:{}},mech_dragon:{weapon:{laser:.84,flame:.1,plasma:.68,kinetic:.18,missile:.75,sonic:.22,shotgun:.28,tesla:1},nozone:{},amp:{}},construct:{weapon:{laser:.5,flame:.2,plasma:.6,kinetic:.34,missile:.9,sonic:.08,shotgun:.28,tesla:1},nozone:{},amp:{}},beholder:{weapon:{laser:.75,flame:.15,plasma:1,kinetic:.45,missile:.05,sonic:.01,shotgun:.12,tesla:.3},nozone:{},amp:{}},worm:{weapon:{laser:.55,flame:.38,plasma:.45,kinetic:.2,missile:.05,sonic:1,shotgun:.02,tesla:.01},nozone:{},amp:{}},hydra:{weapon:{laser:.85,flame:.75,plasma:.85,kinetic:.25,missile:.45,sonic:.5,shotgun:.6,tesla:.65},nozone:{},amp:{}},colossus:{weapon:{laser:1,flame:.05,plasma:.75,kinetic:.45,missile:1,sonic:.35,shotgun:.35,tesla:.5},nozone:{},amp:{}},lich:{weapon:{laser:.1,flame:.1,plasma:.1,kinetic:.45,missile:.75,sonic:.35,shotgun:.75,tesla:.5},nozone:{},amp:{}},ape:{weapon:{laser:1,flame:.95,plasma:.85,kinetic:.5,missile:.5,sonic:.05,shotgun:.35,tesla:.68},nozone:{},amp:{}},bandit:{weapon:{laser:.65,flame:.5,plasma:.85,kinetic:1,missile:.5,sonic:.25,shotgun:.75,tesla:.25},nozone:{},amp:{}},croc:{weapon:{laser:.65,flame:.05,plasma:.6,kinetic:.5,missile:.5,sonic:1,shotgun:.2,tesla:.75},nozone:{},amp:{}},djinni:{weapon:{laser:0,flame:.35,plasma:1,kinetic:.15,missile:0,sonic:.65,shotgun:.22,tesla:.4},nozone:{},amp:{}},snake:{weapon:{laser:.5,flame:.5,plasma:.5,kinetic:.5,missile:.5,sonic:.5,shotgun:.5,tesla:.5},nozone:{},amp:{}},centipede:{weapon:{laser:.5,flame:.85,plasma:.95,kinetic:.65,missile:.6,sonic:0,shotgun:.5,tesla:.01},nozone:{},amp:{}},spider:{weapon:{laser:.65,flame:1,plasma:.22,kinetic:.75,missile:.15,sonic:.38,shotgun:.9,tesla:.18},nozone:{},amp:{}},manticore:{weapon:{laser:.05,flame:.25,plasma:.95,kinetic:.5,missile:.15,sonic:.48,shotgun:.4,tesla:.6},nozone:{},amp:{}},fiend:{weapon:{laser:.75,flame:.25,plasma:.5,kinetic:.25,missile:.75,sonic:.25,shotgun:.5,tesla:.5},nozone:{},amp:{}},bat:{weapon:{laser:.16,flame:.18,plasma:.12,kinetic:.25,missile:.02,sonic:1,shotgun:.9,tesla:.58},nozone:{},amp:{}},medusa:{weapon:{laser:.35,flame:.1,plasma:.3,kinetic:.95,missile:1,sonic:.15,shotgun:.88,tesla:.26},nozone:{},amp:{}},ettin:{weapon:{laser:.5,flame:.35,plasma:.8,kinetic:.5,missile:.25,sonic:.3,shotgun:.6,tesla:.09},nozone:{},amp:{}},faceless:{weapon:{laser:.6,flame:.28,plasma:.6,kinetic:0,missile:.05,sonic:.8,shotgun:.15,tesla:1},nozone:{},amp:{}},enchanted:{weapon:{laser:1,flame:.02,plasma:.95,kinetic:.2,missile:.7,sonic:.05,shotgun:.65,tesla:.01},nozone:{},amp:{}},gargoyle:{weapon:{laser:.15,flame:.4,plasma:.3,kinetic:.5,missile:.5,sonic:.85,shotgun:1,tesla:.2},nozone:{},amp:{}},chimera:{weapon:{laser:.38,flame:.6,plasma:.42,kinetic:.85,missile:.35,sonic:.5,shotgun:.65,tesla:.8},nozone:{},amp:{}},gorgon:{weapon:{laser:.65,flame:.65,plasma:.65,kinetic:.65,missile:.65,sonic:.65,shotgun:.65,tesla:.65},nozone:{},amp:{}},kraken:{weapon:{laser:.75,flame:.35,plasma:.75,kinetic:.35,missile:.5,sonic:.18,shotgun:.05,tesla:.85},nozone:{},amp:{}},homunculus:{weapon:{laser:.05,flame:1,plasma:.1,kinetic:.85,missile:.65,sonic:.5,shotgun:.75,tesla:.2},nozone:{},amp:{}}},
        // export function hellSupression(area, val) from portal.js
        hellSupression: function(t,e){switch(t){case"ruins":{let t=e||buildings.RuinsGuardPost.stateOnCount,r=75*buildings.RuinsArcology.stateOnCount,a=game.armyRating(t*traitVal('high_pop', 0, 1),"hellArmy",0);a*=traitVal('holy', 1, '+');let l=(a+r)/5e3;return{supress:l>1?1:l,rating:a+r}}case"gate":{let t=poly.hellSupression("ruins",e),r=100*buildings.GateTurret.stateOnCount;r*=traitVal('holy', 1, '+');let a=(t.rating+r)/7500;return{supress:a>1?1:a,rating:t.rating+r}}default:return 0}},
        // function taxCap(min) from civics.js
        taxCap: function(e){let a=(haveTech("currency",5)||game.global.race.terrifying)&&!game.global.race.noble;if(e)return a?0:traitVal("noble",0,10);{let e=traitVal("noble",1,30);return a&&(e+=20),"oligarchy"===game.global.civic.govern.type&&(e+=("bureaucrat"===getGovernor()?25:20)),"noble"===getGovernor()&&(e+=20),e}},
        // export function mechCost(size,infernal) from portal.js
        mechCost: function(e,a,x){let l=9999,r=1e7;switch(e){case"small":{let e=(x??game.global.blood.prepared)>=2?5e4:75e3;r=a?2.5*e:e,l=a?20:1}break;case"medium":r=a?45e4:18e4,l=a?100:4;break;case"large":r=a?925e3:375e3,l=a?500:20;break;case"titan":r=a?15e5:75e4,l=a?1500:75;break;case"collector":{let e=(x??game.global.blood.prepared)>=2?8e3:1e4;r=a?2.5*e:e,l=1}}return{s:l,c:r}},
        // function terrainRating(mech,rating,effects) from portal.js
        terrainRating: function(e,i,s,x){return!e.equip.includes("special")||"small"!==e.size&&"medium"!==e.size&&"collector"!==e.size||i<1&&(i+=(1-i)*(s.includes("gravity")?.1:.2)),"small"!==e.size&&i<1&&(i+=(s.includes("fog")||s.includes("dark")?.005:.01)*(x??game.global.portal.mechbay.scouts))>1&&(i=1),i},
        // function weaponPower(mech,power) from portal.js
        weaponPower: function(e,i){return i<1&&0!==i&&e.equip.includes("special")&&"titan"===e.size&&(i+=.25*(1-i)),e.equip.includes("special")&&"large"===e.size&&(i*=1.02),i},
        // export function timeFormat(time) from functions.js
        timeFormat: function(e){let i;if(e<0)i=game.loc("time_never");else if((e=+e.toFixed(0))>60){let l=e%60,s=(e-l)/60;if(s>=60){let e=s%60,l=(s-e)/60;if(l>24){i=`${(l-(e=l%24))/24}d ${e}h`}else i=`${l}h ${e=("0"+e).slice(-2)}m`}else i=`${s=("0"+s).slice(-2)}m ${l=("0"+l).slice(-2)}s`}else i=`${e=("0"+e).slice(-2)}s`;return i},
        // export universeAffix(universe) from achieve.js
        universeAffix: function(e){switch(e=e||game.global.race.universe){case"evil":return"e";case"antimatter":return"a";case"heavy":return"h";case"micro":return"m";case"magic":return"mg";default:return"l"}},
        // export const genus_traits from races.js (added spores:1 to fungi manually)
        genus_traits: {humanoid:{adaptable:1,wasteful:1},carnivore:{carnivore:1,beast:1,cautious:1},herbivore:{herbivore:1,instinct:1},small:{small:1,weak:1},giant:{large:1,strong:1},reptilian:{cold_blooded:1,scales:1},avian:{flier:1,hollow_bones:1,sky_lover:1},insectoid:{high_pop:1,fast_growth:1,high_metabolism:1},plant:{sappy:1,asymmetrical:1},fungi:{detritivore:1,spongy:1,spores:1},aquatic:{submerged:1,low_light:1},fey:{elusive:1,iron_allergy:1},heat:{smoldering:1,cold_intolerance:1},polar:{chilled:1,heat_intolerance:1},sand:{scavenger:1,nomadic:1},demonic:{immoral:1,evil:1,soul_eater:1},angelic:{blissful:1,pompous:1,holy:1},synthetic:{artifical:1,powered:1},eldritch:{psychic:1,tormented:1,darkness:1,unfathomable:1}},
        // export const neg_roll_traits from races.js
        neg_roll_traits: ['diverse','arrogant','angry','lazy','paranoid','greedy','puny','dumb','nearsighted','gluttony','slow','hard_of_hearing','pessimistic','solitary','pyrophobia','skittish','nyctophilia','frail','atrophy','invertebrate','pathetic','invertebrate','unorganized','slow_regen','snowy','mistrustful','fragrant','freespirit','hooved','heavy','gnawer'],

    // Reimplemented:
        // export function crateValue() from resources.js
        crateValue: () => Number(getVueById("createHead")?.buildCrateDesc().match(/(\d+)/g)[1] ?? 0),
        // export function containerValue() from resources.js
        containerValue: () => Number(getVueById("createHead")?.buildContainerDesc().match(/(\d+)/g)[1] ?? 0),
        // export function piracy(region, true, true) from space.js
        piracy: region => Number(getVueById(region)?.$options.filters.defense(region) ?? 0),

    // Firefox compatibility:
        adjustCosts: (c_action, wiki) => game.adjustCosts(cloneInto(c_action, unsafeWindow, {cloneFunctions: true}), wiki),
        loc: (key, variables) => game.loc(key, cloneInto(variables, unsafeWindow)),
        messageQueue: (msg, color, dnr, tags) => game.messageQueue(msg, color, dnr, cloneInto(tags, unsafeWindow)),
        shipCosts: (bp) => game.shipCosts(cloneInto(bp, unsafeWindow)),
    };

    // Export several important variables to the window object, for ease of testing
    if (debugMode) {
        var exportedToWindow = {
            __note: "These variables should be considered read-only, interacting with them may produce undesired results depending on your current browser.",
            buildings,
            jobs,
            state,
            settings,
            settingsRaw,
            resources,
            crafter,
            projects,
            AdvTriggerManager,
        };

        if (typeof unsafeWindow !== 'undefined') {
            unsafeWindow.autoEvolve = exportedToWindow;
        }
        else {
            window.autoEvolve = exportedToWindow;
        }
    }

    $().ready(mainAutoEvolveScript);
})($);
