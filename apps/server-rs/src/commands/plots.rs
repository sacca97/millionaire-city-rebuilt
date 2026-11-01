//! Port of `apps/server/src/commandHandlers/plots.ts` (package "libs-a", see docs/rust-server-plan.md).

use crate::util::js_string_to_number;

/// plots.ts:1 `PLOT_UNLOCK_ORDER`: unlock tier of each plot slot.
pub const PLOT_UNLOCK_ORDER: [i64; 25] = [4, 3, 3, 3, 4, 3, 2, 1, 2, 3, 3, 1, 0, 1, 3, 3, 2, 1, 2, 3, 4, 3, 3, 3, 4];

/// plots.ts:3 `getPlotStates`: the default states (tier 0 owned=2, tier 1 unlocked=1, rest 0) when empty, else
/// `Number()` of each comma-separated value (NaN kept as NaN).
pub fn get_plot_states(type_value: &str) -> Vec<f64> {
    if type_value.is_empty() {
        return PLOT_UNLOCK_ORDER
            .iter()
            .map(|&unlock_order| match unlock_order {
                0 => 2.0,
                1 => 1.0,
                _ => 0.0,
            })
            .collect();
    }
    type_value.split(',').map(js_string_to_number).collect()
}

/// plots.ts:19 `unlockNextPlots`: when every plot of the bought tier is owned (state 2), unlock (state 0 -> 1) the next tier.
/// `bought_index` is a JS number: a non-integer or out-of-range index does nothing.
pub fn unlock_next_plots(states: &mut [f64], bought_index: f64) {
    if bought_index.fract() != 0.0 || !(bought_index >= 0.0 && (bought_index as usize) < PLOT_UNLOCK_ORDER.len()) {
        return;
    }
    let bought_unlock_order = PLOT_UNLOCK_ORDER[bought_index as usize];

    let all_current_plots_owned = PLOT_UNLOCK_ORDER
        .iter()
        .enumerate()
        .all(|(index, &unlock_order)| unlock_order != bought_unlock_order || states.get(index) == Some(&2.0));
    if !all_current_plots_owned {
        return;
    }

    let next_unlock_order = bought_unlock_order + 1;
    for (index, &unlock_order) in PLOT_UNLOCK_ORDER.iter().enumerate() {
        if unlock_order == next_unlock_order && states.get(index) == Some(&0.0) {
            states[index] = 1.0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::universe::fixture::{assert_same, cases, num};
    use serde_json::Value;

    #[test]
    fn get_plot_states_matches_ts() {
        for case in cases("getPlotStates") {
            let args = case.input.clone();
            let out = Value::Array(get_plot_states(args["typeValue"].as_str().unwrap()).into_iter().map(num).collect());
            assert_same(&out, &case.output, "getPlotStates output");
            assert_same(&args, &case.mutated, "getPlotStates mutatedInput");
        }
    }

    #[test]
    fn unlock_next_plots_matches_ts() {
        for case in cases("unlockNextPlots") {
            let args = case.input.clone();
            let mut states: Vec<f64> = args["states"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
            unlock_next_plots(&mut states, args["boughtIndex"].as_f64().unwrap());
            let mut after = args.clone();
            after["states"] = Value::Array(states.into_iter().map(num).collect());
            assert_same(&Value::Null, &case.output, "unlockNextPlots output");
            assert_same(&after, &case.mutated, "unlockNextPlots mutatedInput");
        }
    }
}
