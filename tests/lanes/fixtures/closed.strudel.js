// Lanes L1 fixture: closed mode. bass reads the unexported tap of drums: E_LANE_PRIVATE.
lanes.closed()
drums: s("bd*4").tags("drums").tap("kick")
bass: note("c2*4").s("sawtooth").gain(tap("kick:env"))
