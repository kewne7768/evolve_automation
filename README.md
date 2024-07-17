Soft fork of random assorted changes.

This is how I automate my personal gameplay, but some of these changes are opinionated and may not work well with every playstyle covered by the original script. I don't have a particularly rigid testing system set up, so not all changes may be tested equally well.

Summary of changes:

* Snippet system: allows executing custom JavaScript code that modifies script settings, programatically runs triggers and more. See [snippet-samples](https://github.com/kewne7768/snippet-samples) for examples. This can replace quite a few things that would otherwise require script edits. **API is not stable at the moment.**
* Trigger system now includes an on/off toggle that can be changed via overrides, allowing you to disable triggers. (Note this override only works on the triggers.)
* Different autoSmelter algorithm that tries to keep around 10% of smelters on Iron when "prioritize Steel" is selected, with a few safeties. This results in lower Steel production, but significantly increased Iron production, which tends to result in increased Steel production. Funny how that works.
* Various calculations based on your resource storage ratio were adjusted to try and keep around 120 seconds of usage instead. This works better at high prestige levels, but if you can barely keep up with demand, this may be sub-optimal compared to the old ones.
* Export button for script settings.
* Stellar Engine stabilize now has a configurable cooldown to try and reduce the game's lag somewhat.
* Toggle to start working on Unification early. This must be set carefully with overrides as doing it too early may result in the script saving millions of money for purchases incredibly early.
* Changes to TP3 autoFleet to allow for simple changes of Scout ship mid-run (do not change hull type). Also, there is a hacky way to script per-region ships.
* Changes to the order of how Tau Ceti is built up and powered during the materials phase. For best effect, ensure the Jump Gate is not built until you're happy. This has not seen testing in situations where you may be limited by Money instead of Materials and may break in those cases.
* Changes to autoBuild to account for high-prestige gameplay, increasing the speed at which buildings can be built. Options were added under Building Settings.
* Several dirty hacks to improve game performance. These are disabled by default and can be enabled from General Settings.
* Ctrl/alt/shift keys now work.
* Prestige logging database. This can be enabled under Logging Settings. Unfortunately, at the moment, all configuration for this feature is missing, and the hard-coded graph is set up to accompany T4 farm runs with [this snippet](https://github.com/kewne7768/snippet-samples/blob/main/Prestige%20Log%20Milestones.js) installed. You can however get a JSON export of all your runs.
* Misc fixes I'd like to send back but haven't had the time to properly go and test

You can find the official version by Volch [here](https://gist.github.com/Vollch/b1a5eec305558a48b7f4575d317d7dd1).
