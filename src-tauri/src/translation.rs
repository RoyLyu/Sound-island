const PHRASES: &[(&str, &str)] = &[
    ("parking garage", "停车库"),
    ("machine gun", "机枪"),
    ("body falls", "身体倒地"),
    ("body fall", "身体倒地"),
    ("church bells", "教堂钟声"),
    ("chainlink fence", "铁丝网围栏"),
    ("wind shield", "挡风玻璃"),
    ("windshield", "挡风玻璃"),
    ("liquid nitrogen", "液氮"),
    ("vacuum pump", "真空泵"),
    ("power supply", "电源"),
    ("control data", "控制数据"),
    ("room tone", "室内底噪"),
    ("fire ball", "火球"),
    ("fireball", "火球"),
    ("low end", "低频"),
    ("heavy oil", "重油"),
    ("auto stirrer", "自动搅拌器"),
    ("glass bottle", "玻璃瓶"),
    ("pool cue", "台球杆"),
    ("pool balls", "台球"),
];

const WORDS: &[(&str, &str)] = &[
    ("ambience", "环境"), ("ambient", "环境"), ("atmosphere", "氛围"),
    ("rain", "雨"), ("wind", "风"), ("storm", "暴风雨"), ("thunder", "雷声"),
    ("fire", "火焰"), ("flame", "火焰"), ("crackle", "噼啪"), ("gas", "燃气"),
    ("door", "门"), ("gate", "大门"), ("window", "窗"), ("open", "开启"), ("close", "关闭"),
    ("glass", "玻璃"), ("ceramic", "陶瓷"), ("vase", "花瓶"), ("pottery", "陶器"),
    ("crash", "撞碎"), ("break", "破碎"), ("bust", "击碎"), ("rattle", "晃动声"),
    ("impact", "撞击"), ("hit", "击打"), ("hard", "重"), ("soft", "轻"),
    ("body", "身体"), ("fall", "倒地"), ("falls", "倒地"), ("thud", "闷响"), ("thuddy", "闷重"),
    ("dirt", "泥地"), ("subtle", "轻微"), ("short", "短促"), ("long", "长"),
    ("footstep", "脚步"), ("footsteps", "脚步"), ("walk", "行走"), ("run", "奔跑"),
    ("car", "汽车"), ("cars", "汽车"), ("vehicle", "车辆"), ("engine", "引擎"),
    ("skid", "急刹打滑"), ("skids", "急刹打滑"), ("tire", "轮胎"), ("tires", "轮胎"),
    ("gun", "枪械"), ("rifle", "步枪"), ("pistol", "手枪"), ("bullet", "子弹"), ("bullets", "子弹"),
    ("metal", "金属"), ("wood", "木材"), ("stone", "石材"), ("fence", "围栏"),
    ("whoosh", "呼啸"), ("swoosh", "呼啸"), ("riser", "上升音"), ("drone", "持续氛围"),
    ("beep", "提示音"), ("beeps", "提示音"), ("click", "点击"), ("clicks", "点击"),
    ("bell", "钟声"), ("bells", "钟声"), ("deep", "低沉"), ("fast", "快速"),
    ("light", "轻柔"), ("heavy", "厚重"), ("single", "单次"), ("singles", "单次"),
    ("pump", "泵"), ("transformer", "变压器"), ("spectrometer", "光谱仪"),
    ("detector", "探测器"), ("helium", "氦气"), ("vacuum", "真空"),
    ("air", "空气"), ("escape", "泄压"), ("bursts", "爆发"), ("data", "数据"),
    ("on", "开启"), ("off", "关闭"), ("room", "房间"), ("marker", "标记"),
];

fn cleaned_tokens(name: &str) -> Vec<String> {
    name.chars()
        .map(|character| if character.is_alphanumeric() { character } else { ' ' })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_lowercase)
        .collect()
}

pub fn translate_name(name: &str) -> String {
    let tokens = cleaned_tokens(name);
    let mut translated = Vec::new();
    let mut index = 0;

    while index < tokens.len() {
        let mut matched = false;
        for (phrase, chinese) in PHRASES {
            let phrase_tokens: Vec<&str> = phrase.split_whitespace().collect();
            if index + phrase_tokens.len() <= tokens.len()
                && tokens[index..index + phrase_tokens.len()].iter().map(String::as_str).eq(phrase_tokens.iter().copied())
            {
                translated.push((*chinese).to_string());
                index += phrase_tokens.len();
                matched = true;
                break;
            }
        }
        if matched {
            continue;
        }

        let token = &tokens[index];
        let replacement = WORDS.iter().find_map(|(source, target)| (*source == token).then_some(*target));
        translated.push(replacement.unwrap_or(token).to_string());
        index += 1;
    }

    translated.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_common_sound_library_names_locally() {
        assert_eq!(translate_name("-035_04 body falls (hard)"), "035 · 04 · 身体倒地 · 重");
        assert_eq!(translate_name("-052_01 church BELLS"), "052 · 01 · 教堂钟声");
        assert_eq!(translate_name("FIRE--gas tank whoosh"), "火焰 · 燃气 · tank · 呼啸");
    }

    #[test]
    fn preserves_catalog_codes_and_unknown_terms() {
        assert_eq!(translate_name("ZXCV_000192"), "zxcv · 000192");
    }
}
