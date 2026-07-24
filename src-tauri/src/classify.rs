use crate::ucs_catalog::{UcsTerm, UCS_RULES, UCS_TERMS};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    path::Path,
    sync::OnceLock,
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Classification {
    pub category: String,
    pub subcategory: String,
    pub tags: Vec<String>,
}

type TermIndex = HashMap<&'static str, Vec<(usize, u16)>>;
pub const CLASSIFIER_VERSION: &str = "ucs-8.2.1-r2";

fn term_index() -> &'static TermIndex {
    static INDEX: OnceLock<TermIndex> = OnceLock::new();
    INDEX.get_or_init(|| {
        let mut index = HashMap::<&'static str, Vec<(usize, u16)>>::new();
        for UcsTerm { term, rule, weight } in UCS_TERMS {
            index.entry(term).or_default().push((*rule, *weight));
        }
        index
    })
}

fn normalize(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut previous_space = true;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_alphanumeric() || ('\u{3400}'..='\u{9fff}').contains(&character) {
            output.push(character);
            previous_space = false;
        } else if !previous_space {
            output.push(' ');
            previous_space = true;
        }
    }
    output.trim().to_string()
}

fn contains_cjk(value: &str) -> bool {
    value
        .chars()
        .any(|character| ('\u{3400}'..='\u{9fff}').contains(&character))
}

fn search_keys(value: &str) -> HashSet<String> {
    let normalized = normalize(value);
    let tokens = normalized.split_whitespace().collect::<Vec<_>>();
    let mut keys = HashSet::new();
    if !normalized.is_empty() {
        keys.insert(normalized.clone());
    }
    for start in 0..tokens.len() {
        for length in 1..=4.min(tokens.len() - start) {
            keys.insert(tokens[start..start + length].join(" "));
        }
        let token = tokens[start];
        if token.len() > 4 && token.ends_with('s') {
            keys.insert(token[..token.len() - 1].to_string());
        } else if token.len() > 3
            && token
                .chars()
                .all(|character| character.is_ascii_alphabetic())
        {
            keys.insert(format!("{token}s"));
        }
        if contains_cjk(token) {
            let characters = token.chars().collect::<Vec<_>>();
            for offset in 0..characters.len() {
                for length in 1..=8.min(characters.len() - offset) {
                    keys.insert(characters[offset..offset + length].iter().collect());
                }
            }
        }
    }
    keys
}

fn score(
    value: &str,
    multiplier: u32,
    rule_scores: &mut [u32],
    category_scores: &mut HashMap<&'static str, u32>,
) {
    let index = term_index();
    for key in search_keys(value) {
        if let Some(matches) = index.get(key.as_str()) {
            let mut category_weights = HashMap::<&'static str, u16>::new();
            let max_weight = matches
                .iter()
                .map(|(_, weight)| *weight)
                .max()
                .unwrap_or_default();
            let strongest = matches
                .iter()
                .filter(|(_, weight)| *weight == max_weight)
                .collect::<Vec<_>>();

            for (rule, weight) in matches {
                let category_code = UCS_RULES[*rule].category_code;
                category_weights
                    .entry(category_code)
                    .and_modify(|current| *current = (*current).max(*weight))
                    .or_insert(*weight);
            }
            for (category_code, weight) in category_weights {
                *category_scores.entry(category_code).or_default() +=
                    u32::from(weight) * multiplier;
            }

            if strongest.len() == 1 {
                let (rule, weight) = strongest[0];
                rule_scores[*rule] += u32::from(*weight) * multiplier;
            }
        }
    }
}

fn unique_best<'a, I>(values: I) -> Option<(&'a str, u32)>
where
    I: Iterator<Item = (&'a str, u32)>,
{
    let mut ordered = values.collect::<Vec<_>>();
    ordered.sort_by_key(|(_, score)| std::cmp::Reverse(*score));
    let best = ordered.first().copied()?;
    if ordered.get(1).is_some_and(|second| second.1 == best.1) {
        None
    } else {
        Some(best)
    }
}

fn tags(path: &Path) -> Vec<String> {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    normalize(stem)
        .split_whitespace()
        .filter(|token| token.chars().count() > 1)
        .take(12)
        .map(str::to_string)
        .collect()
}

pub fn classify(path: &Path) -> Classification {
    let mut rule_scores = vec![0_u32; UCS_RULES.len()];
    let mut category_scores = HashMap::<&'static str, u32>::new();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    score(stem, 3, &mut rule_scores, &mut category_scores);
    score(
        &path.to_string_lossy(),
        1,
        &mut rule_scores,
        &mut category_scores,
    );

    let best_category = unique_best(category_scores.into_iter())
        .filter(|(_, score)| *score >= 4)
        .map(|(category, _)| category);
    let mut rule_candidates = rule_scores
        .iter()
        .enumerate()
        .filter(|(index, _)| {
            best_category.is_some_and(|category| UCS_RULES[*index].category_code == category)
        })
        .map(|(index, score)| (index, *score))
        .collect::<Vec<_>>();
    rule_candidates.sort_by_key(|(_, score)| std::cmp::Reverse(*score));
    let best_rule = rule_candidates
        .first()
        .filter(|(_, score)| *score >= 4)
        .filter(|(_, score)| {
            rule_candidates
                .get(1)
                .map_or(true, |(_, second_score)| second_score != score)
        })
        .map(|(index, _)| &UCS_RULES[*index]);

    match (best_category, best_rule) {
        (Some(_), Some(rule)) => Classification {
            category: format!("{} / {}", rule.category_zh, rule.category_code),
            subcategory: format!(
                "{} / {} · {}",
                rule.subcategory_zh, rule.subcategory_code, rule.cat_id
            ),
            tags: tags(path),
        },
        (Some(category_code), None) => {
            let category = UCS_RULES
                .iter()
                .find(|rule| rule.category_code == category_code)
                .expect("category score must come from an existing UCS rule");
            Classification {
                category: format!("{} / {}", category.category_zh, category.category_code),
                subcategory: "未细分 / UNSPECIFIED".into(),
                tags: tags(path),
            }
        }
        (None, _) => Classification {
            category: "待归类 / UNCATEGORIZED".into(),
            subcategory: "未匹配 / MISC".into(),
            tags: tags(path),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_official_ucs_labels_for_common_sound_names() {
        let footsteps = classify(Path::new("Foley/Leather_Boots_Footsteps.aif"));
        assert_eq!(footsteps.category, "脚步 / FOOTSTEPS");

        let jet = classify(Path::new("008 Jet Takes Off.wav"));
        assert_eq!(jet.category, "航空器 / AIRCRAFT");
        assert!(jet.subcategory.contains("AEROJet"));

        let door = classify(Path::new("Metal Door Slam.wav"));
        assert_eq!(door.category, "门 / DOORS");
    }

    #[test]
    fn does_not_invent_a_child_category_from_shared_parent_terms() {
        let ambience = classify(Path::new("what if_环境声/ZOOM0184_LR.WAV"));
        assert_eq!(ambience.category, "环境 / AMBIENCE");
        assert_eq!(ambience.subcategory, "未细分 / UNSPECIFIED");
    }

    #[test]
    fn keeps_unmatched_files_in_an_explicit_bucket() {
        assert_eq!(
            classify(Path::new("000000.xyz")).category,
            "待归类 / UNCATEGORIZED"
        );
    }
}
