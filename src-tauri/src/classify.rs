use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Classification {
    pub category: String,
    pub subcategory: String,
    pub tags: Vec<String>,
}

struct Rule {
    category: &'static str,
    subcategory: &'static str,
    terms: &'static [&'static str],
}

const RULES: &[Rule] = &[
    Rule { category: "设计音 Design", subcategory: "转场 / Whoosh", terms: &["whoosh", "woosh", "swoosh", "transition", "转场", "呼啸"] },
    Rule { category: "设计音 Design", subcategory: "上升 / Riser", terms: &["riser", "rise", "uplifter", "build up", "上升", "渐强"] },
    Rule { category: "设计音 Design", subcategory: "低频 / Braam", terms: &["braam", "boom", "sub drop", "downer", "低频", "重音"] },
    Rule { category: "设计音 Design", subcategory: "氛围设计 / Drone", terms: &["drone", "tonal", "designed", "cinematic", "trailer", "sound design", "设计音"] },
    Rule { category: "武器 Weapons", subcategory: "枪械 / Guns", terms: &["gun", "gunshot", "shot", "rifle", "pistol", "revolver", "firearm", "枪", "步枪", "手枪", "开火"] },
    Rule { category: "武器 Weapons", subcategory: "刀剑 / Blades", terms: &["sword", "knife", "blade", "saber", "katana", "dagger", "刀", "剑", "拔刀"] },
    Rule { category: "武器 Weapons", subcategory: "弹药 / Ammunition", terms: &["bullet", "shell", "ammo", "reload", "magazine", "子弹", "弹壳", "换弹"] },
    Rule { category: "交通 Vehicles", subcategory: "汽车 / Cars", terms: &["car", "auto", "vehicle", "sedan", "suv", "truck", "bus", "汽车", "轿车", "卡车", "巴士"] },
    Rule { category: "交通 Vehicles", subcategory: "发动机 / Engines", terms: &["engine", "motor", "ignition", "rev", "idle", "发动机", "引擎", "点火"] },
    Rule { category: "交通 Vehicles", subcategory: "航空 / Aircraft", terms: &["airplane", "aircraft", "jet", "helicopter", "plane", "飞机", "直升机", "喷气"] },
    Rule { category: "交通 Vehicles", subcategory: "轨道交通 / Rail", terms: &["train", "rail", "subway", "metro", "tram", "火车", "地铁", "电车"] },
    Rule { category: "交通 Vehicles", subcategory: "船舶 / Watercraft", terms: &["boat", "ship", "watercraft", "submarine", "船", "轮船", "潜艇"] },
    Rule { category: "生物 Creature", subcategory: "怪兽 / Monsters", terms: &["creature", "monster", "growl", "roar", "beast", "demon", "怪兽", "怪物", "低吼", "咆哮"] },
    Rule { category: "生物 Creature", subcategory: "动物 / Animals", terms: &["animal", "dog", "cat", "horse", "cow", "pig", "犬", "狗", "猫", "马", "动物"] },
    Rule { category: "生物 Creature", subcategory: "鸟类 / Birds", terms: &["bird", "crow", "raven", "eagle", "owl", "鸟", "乌鸦", "鹰"] },
    Rule { category: "生物 Creature", subcategory: "昆虫 / Insects", terms: &["insect", "bee", "fly", "mosquito", "cricket", "虫", "蜜蜂", "蚊"] },
    Rule { category: "界面 UI", subcategory: "点击 / Clicks", terms: &["ui", "interface", "button", "click", "select", "toggle", "界面", "按钮", "点击"] },
    Rule { category: "界面 UI", subcategory: "通知 / Notifications", terms: &["notification", "alert", "message", "success", "error", "通知", "提示", "警告"] },
    Rule { category: "界面 UI", subcategory: "电子提示 / Beeps", terms: &["beep", "bleep", "digital", "computer", "scanner", "电子", "滴声", "蜂鸣"] },
    Rule { category: "拟音 Foley", subcategory: "脚步 / Footsteps", terms: &["footstep", "footsteps", "steps", "walk", "walking", "run", "boots", "shoe", "脚步", "走路", "跑步", "鞋"] },
    Rule { category: "拟音 Foley", subcategory: "衣物 / Cloth", terms: &["cloth", "clothes", "fabric", "movement", "rustle", "衣物", "布料", "摩擦"] },
    Rule { category: "拟音 Foley", subcategory: "身体 / Body", terms: &["body", "hand", "grab", "skin", "breath", "kiss", "身体", "手", "抓", "呼吸"] },
    Rule { category: "拟音 Foley", subcategory: "道具 / Props", terms: &["foley", "prop", "keys", "bag", "paper", "book", "cup", "拟音", "道具", "钥匙", "纸", "书"] },
    Rule { category: "硬音效 Hard FX", subcategory: "撞击 / Impacts", terms: &["impact", "hit", "slam", "crash", "thud", "punch", "撞击", "击打", "重击", "碰撞"] },
    Rule { category: "硬音效 Hard FX", subcategory: "爆炸 / Explosions", terms: &["explosion", "explode", "blast", "detonation", "爆炸", "爆破"] },
    Rule { category: "硬音效 Hard FX", subcategory: "破碎 / Breaks", terms: &["break", "debris", "shatter", "glass", "碎裂", "破碎", "玻璃"] },
    Rule { category: "硬音效 Hard FX", subcategory: "门窗 / Doors", terms: &["door", "window", "gate", "latch", "hinge", "门", "窗", "门锁"] },
    Rule { category: "硬音效 Hard FX", subcategory: "材质 / Materials", terms: &["metal", "wood", "plastic", "stone", "concrete", "金属", "木头", "塑料", "石头"] },
    Rule { category: "环境 Ambience", subcategory: "室内底噪 / Room Tone", terms: &["room tone", "roomtone", "interior", "indoor", "quiet room", "室内", "房间底噪", "空房"] },
    Rule { category: "环境 Ambience", subcategory: "天气 / Weather", terms: &["rain", "storm", "thunder", "wind", "snow", "weather", "雨", "暴雨", "雷", "风", "雪"] },
    Rule { category: "环境 Ambience", subcategory: "城市 / Urban", terms: &["city", "urban", "street", "traffic", "crowd", "market", "城市", "街道", "车流", "人群", "市场"] },
    Rule { category: "环境 Ambience", subcategory: "自然 / Nature", terms: &["forest", "nature", "river", "ocean", "sea", "mountain", "jungle", "森林", "自然", "河流", "海", "山"] },
    Rule { category: "环境 Ambience", subcategory: "环境 / General", terms: &["ambience", "ambiance", "ambient", "atmosphere", "background", "环境", "氛围", "背景"] },
];

fn filename_tags(path: &Path) -> Vec<String> {
    let stem = path.file_stem().and_then(|value| value.to_str()).unwrap_or_default();
    let mut tags = Vec::new();
    for token in stem.split(|character: char| !character.is_alphanumeric()) {
        let normalized = token.trim().to_lowercase();
        if normalized.chars().count() >= 2 && !tags.contains(&normalized) {
            tags.push(normalized);
        }
        if tags.len() == 10 { break; }
    }
    tags
}

pub fn classify(path: &Path) -> Classification {
    let raw = path.to_string_lossy().to_lowercase();
    let normalized: String = raw
        .chars()
        .map(|character| if character.is_alphanumeric() { character } else { ' ' })
        .collect();
    let padded = format!(" {} ", normalized.split_whitespace().collect::<Vec<_>>().join(" "));
    let mut best: Option<(&Rule, usize)> = None;

    for rule in RULES {
        let score = rule.terms.iter().filter(|term| {
            if term.is_ascii() {
                padded.contains(&format!(" {} ", term))
            } else {
                raw.contains(**term)
            }
        }).count();
        if score > 0 && best.as_ref().map(|(_, current)| score > *current).unwrap_or(true) {
            best = Some((rule, score));
        }
    }

    let tags = filename_tags(path);
    if let Some((rule, _)) = best {
        Classification { category: rule.category.into(), subcategory: rule.subcategory.into(), tags }
    } else {
        Classification { category: "未分类".into(), subcategory: "待整理".into(), tags }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_bilingual_common_names() {
        assert_eq!(classify(Path::new("Library/AMB_Rain_Heavy_01.wav")).category, "环境 Ambience");
        assert_eq!(classify(Path::new("拟音/Leather_Boots_Footsteps.aif")).subcategory, "脚步 / Footsteps");
        assert_eq!(classify(Path::new("Creature_Monster_Growl_03.wav")).category, "生物 Creature");
        assert_eq!(classify(Path::new("UI_Notification_Success.wav")).category, "界面 UI");
        assert_eq!(classify(Path::new("车辆/Car Engine Idle.wav")).category, "交通 Vehicles");
    }

    #[test]
    fn leaves_unknown_files_uncategorized() {
        assert_eq!(classify(Path::new("ZXCV_000192.wav")).category, "未分类");
    }
}
