atom("kick4", { type: "mini", params: { n: { shape: "number", min: 1, max: 16, step: 1, default: 4 } }, body: "bd*${n}" })
atom("backbeat", { type: "mini", body: "~ sd ~ sd" })
atom("groove", { type: "mini", body: { $stack: [{ $atom: "kick4" }, { $atom: "backbeat" }] } })
$: s(atoms.groove)
