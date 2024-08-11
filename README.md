Soft fork of random assorted changes.

This is how I automate my personal gameplay, but some of these changes are opinionated and may not work well with every playstyle covered by the original script. I don't have a particularly rigid testing system set up, so not all changes may be tested equally well.

Summary of changes:

* Snippet system: allows executing custom JavaScript code that modifies script settings, programatically runs triggers and more. See [snippet-samples](https://github.com/kewne7768/snippet-samples) for examples. This can replace quite a few things that would otherwise require script edits. The API should be fairly stable at this point, with new things being added in backwards compatible ways, but compatibility can never be long-term guaranteed as game changes may force things to change.
* Trigger system now includes an on/off toggle that can be changed via overrides, allowing you to disable triggers. (Note this override only works on the triggers.)
* Toggle to start working on Unification early. This must be set carefully with overrides as doing it too early may result in the script saving millions of money for purchases incredibly early.
* Changes to TP3 autoFleet to allow for simple changes of Scout ship mid-run (do not change hull type). Also, there is a hacky way to script per-region ships.
* Changes to the order of how Tau Ceti is built up and powered during the materials phase. For best effect, ensure the Jump Gate is not built until you're happy. This has not seen testing in situations where you may be limited by Money instead of Materials and may break in those cases. This may be reverted in the future in favor of a Snippet to handle this situation using dynamic triggers.
* Changes to autoBuild to account for high-prestige gameplay, increasing the speed at which buildings can be built. Options were added under Building Settings.
** "(Dangerous) Number of times to run autoBuild each tick". This allows building multiple sets of the same buildings within each script tick. This can be used to increase the rate of which buildings are built when they're very cheap. This only makes sense in high prestige scenarios, and numbers above 2-3 usually only make sense during the MAD phase of the game. It's suggested to use this only with overrides.
* Smelter system reworked. Set Production Settings > Maximum Iron Ratio to your liking, or check out the new Configured Iron Ratio type if you want to set it yourself. (This is the fourth attempt at a major smelter rework in this fork's short lifespan.)
** By default, when using "Prioritize Steel" mode, all smelters will be set to Steel. If Iron is in demand, it will dedicate "Maximum Iron Ratio" % of smelters to Iron instead.
** When using the new "Configured Iron Ratio" mode, it will always split smelters according to that ratio. Even if it's 0. You do you.
** Note that Iridium is split off *first* when available (mimics old behavior). If you set the Iridium ratio to 0.3 and the Iron ratio to 0.5, then the real ratio will be 30% Iridium, 35% Iron, 35% Steel.
* Prestige logging database. This can be enabled under Logging Settings. Unfortunately, at the moment, configuration for this feature is almost nonexistent aside from on/off. There is a builtin hard-coded graph available set up to accompany T4 farm runs with [this snippet](https://github.com/kewne7768/snippet-samples/blob/main/Prestige%20Log%20Milestones.js) installed. You can also export your run database to CSV or JSON and process it using your favorite data visualization tools.
* Misc fixes I'd like to send back but haven't had the time to properly go and test

You can find the official version by Volch [here](https://github.com/Vollch/Evolve-Automation).
