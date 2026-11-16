// Electro example (#124): F minor, 128 bpm, 40 bars = 75 s, 8 bars per section: electro-funk (808 kit, robot lead) into electro house
// (filtered saw bass, supersaw stabs ducked by the kick, clap build). intro 1-8 | build 9-16 | drop 17-24 | break 25-32 | drop 2 33-40
setcpm(128 / 4)
atoms.import("pack:glyphcore/dnb-electro:atoms-electro")
atoms.import("pack:glyphcore/edm:atoms-edm-core")
// racks: pack:glyphcore/dnb-electro:racks-dnb-electro, pack:glyphcore/edm:racks-edm-core

// == moves on gates: the build thins the funk kit and opens the house bass; the riser ends on each drop ==
hooks.bind("thin", "thinBuild", atoms.el.build); hooks.bind("open", "filterBuild", atoms.el.build)
hooks.bind("rise", "noiseRiser(15)", "9b..17b"); hooks.bind("rise4", "noiseRiser(7.5)", "29b..33b")
hooks.bind("hit", "impactBoom", "17b..18b, 33b..34b"); hooks.bind("crash", "crash", "17b..18b, 33b..34b"); hooks.bind("sweep", "downSweep", "25b..26b")

// == electro-funk (intro, build, break) ==
fkick: s(atoms.el.kick).hook("boom808").use("thin").tags("funk")
fclap: s(atoms.el.clap).hook("clap808").use("thin").tags("funk")
fhat: s(atoms.el.hats).velocity(atoms.el.hatVel).hook("hat808").tags("funk")
bell: s(atoms.el.cowbell).note("[c#5,g#5]").hook("cowbell808").use("thin").tags("funk")
fbass: note(atoms.el.bass).hook("electroBass").use("thin").tags("funk")
lead: note(atoms.el.lead).vowel(atoms.el.leadVowel).hook("vocoLead").delay(0.25).delaytime(0.352).delayfeedback(0.3).tags("lead", "wet")
robot: note(atoms.el.chords).struct(atoms.el.stabs).hook("robotStab").tags("robot", "wet")

// == electro house (drops) ==
kick: s(atoms.el.ehKick).hook("houseKick | sidechain(3, 0.8, 0.18)").tags("house")
clap: s(atoms.el.ehClap).hook("clap808").tags("house")
ohat: s(atoms.el.ehHat).hook("offHat").tags("house")
bass: note(atoms.el.ehBass).hook("filterBass | ducked(3)").use("open").tags("hbass")
stabs: note(atoms.el.chords).struct(atoms.el.ehStabs).hook("sawStab | ducked(3)").tags("house", "wet")
build: s(atoms.ec.roll8).velocity(atoms.ec.rollVel8).hook("clap808").tags("build")

// == fx and buses ==
rise: s("x/8").use("rise", { else: "silence" }).tags("rise")              // one 8-bar note: the riser's attack is its length
rise4: s("x/4").use("rise4", { else: "silence" }).tags("rise")
hit: s("x").use("hit", { else: "silence" }).note("f1").tags("fx")
crash: s("x").use("crash", { else: "silence" }).tags("fx")
sweep: s("x").use("sweep", { else: "silence" }).tags("fx")
verb: ret("verb").room(1).rsize(3).hpf(250).lpf(6000).orbit(8)
glue: ret("glue").compressor("-20:3:6:.01:.15").gain(0.5).orbit(9)
tagged("wet").send("verb", 0.25); tagged("funk | house").send("glue", 0.3)

// == arrangement ==
tagged("funk").mute("17b..25b, @33b"); tagged("#lead").mute("<5b, 9b..13b, 17b..25b"); tagged("robot").mute("<25b")
tagged("house").mute("<17b, 25b..33b"); tagged("hbass").mute("<9b, 25b..33b"); tagged("build").mute("<9b, @17b")
tagged("!rise").mute(atoms.el.vacuum)
