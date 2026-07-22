const PHRASES: &[(&str, &str)] = &[
    (
        "elephant footsteps fast onboard close many walking various tempos",
        "多只大象快速行走脚步（贴身近距拾音，多种速度变化）",
    ),
    (
        "elephant footsteps medium onboard close few walking various tempos",
        "少量大象中速行走脚步（贴身近距拾音，多种速度变化）",
    ),
    (
        "elephant footsteps slow onboard close multi walking various tempos",
        "多只大象缓慢行走脚步（贴身近距拾音，多种速度变化）",
    ),
    (
        "elephant footsteps fast onboard close many walking various",
        "多只大象快速行走脚步（贴身近距拾音，多种变化）",
    ),
    (
        "elephant footsteps medium onboard close few",
        "少量大象中速脚步（贴身近距拾音）",
    ),
    (
        "elephant footsteps slow onboard close multiple",
        "多只大象缓慢行走脚步（贴身近距拾音）",
    ),
    ("bull trot by away footsteps", "远处公牛小跑经过的脚步声"),
    (
        "bull in chute footsteps clatter cowbell",
        "围栏内公牛脚步、碰撞与牛铃",
    ),
    ("car interior parking raining", "雨中停车的车内环境"),
    ("car interior parking silent", "静止车辆内部环境"),
    ("machine gun bullets car", "机枪子弹击中汽车"),
    ("attic a small windy train pass by", "阁楼微风中列车驶过"),
    ("male mouth inhale and exhale", "男性口鼻吸气与呼气"),
    ("body falls subtle dirt", "身体轻摔泥地"),
    ("body falls hard", "身体重摔"),
    ("fire gas tank whoosh", "燃气罐火焰呼啸"),
    ("parking garage skidding", "停车库轮胎打滑"),
    ("large glass crashes", "大型玻璃碎裂"),
    ("glass bottle crashes", "玻璃瓶碎裂"),
    ("auto repair shop", "汽车维修间"),
    ("train pass by", "列车驶过"),
    ("parking garage", "停车库"),
    ("machine gun", "机枪"),
    ("body falls", "身体倒地"),
    ("body fall", "身体倒地"),
    ("church bells", "教堂钟声"),
    ("chainlink fence", "铁丝网围栏"),
    ("wind shield", "挡风玻璃"),
    ("liquid nitrogen", "液氮"),
    ("vacuum pump", "真空泵"),
    ("power supply", "电源"),
    ("control data", "控制数据"),
    ("room tone", "室内底噪"),
    ("low end", "低频"),
    ("heavy oil", "重油"),
    ("auto stirrer", "自动搅拌器"),
    ("glass bottle", "玻璃瓶"),
    ("pool cue", "台球杆"),
    ("pool balls", "台球碰撞"),
    ("door close", "关门"),
    ("door open", "开门"),
    ("window close", "关窗"),
    ("window open", "开窗"),
    ("pass by", "经过"),
    ("4.0 hi", "4.0 高位声道"),
    ("4.0 lo", "4.0 低位声道"),
];

const WORDS: &[(&str, &str)] = &[
    ("ambience", "环境声"),
    ("ambient", "环境声"),
    ("atmosphere", "氛围"),
    ("rain", "雨声"),
    ("raining", "雨声"),
    ("wind", "风声"),
    ("windy", "有风"),
    ("storm", "暴风雨"),
    ("thunder", "雷声"),
    ("fire", "火焰"),
    ("flame", "火焰"),
    ("crackle", "噼啪声"),
    ("gas", "燃气"),
    ("tank", "罐体"),
    ("door", "门"),
    ("gate", "大门"),
    ("window", "窗"),
    ("open", "开启"),
    ("close", "近距离"),
    ("glass", "玻璃"),
    ("ceramic", "陶瓷"),
    ("vase", "花瓶"),
    ("pottery", "陶器"),
    ("crash", "撞碎"),
    ("crashes", "碎裂"),
    ("break", "破碎"),
    ("bust", "击碎"),
    ("rattle", "晃动声"),
    ("impact", "撞击"),
    ("hit", "击打"),
    ("hard", "重"),
    ("soft", "轻"),
    ("body", "身体"),
    ("fall", "倒地"),
    ("falls", "倒地"),
    ("thud", "闷响"),
    ("thuddy", "闷重"),
    ("dirt", "泥地"),
    ("subtle", "轻微"),
    ("short", "短促"),
    ("long", "长"),
    ("footstep", "脚步声"),
    ("footsteps", "脚步声"),
    ("walk", "行走"),
    ("walking", "行走"),
    ("elephant", "大象"),
    ("bull", "公牛"),
    ("cowbell", "牛铃"),
    ("clatter", "连续碰撞声"),
    ("chute", "围栏通道"),
    ("onboard", "贴身拾音"),
    ("away", "远处"),
    ("distant", "远距离"),
    ("medium", "中速"),
    ("slow", "缓慢"),
    ("many", "多只"),
    ("few", "少量"),
    ("multiple", "多只"),
    ("various", "多种变化"),
    ("tempo", "速度变化"),
    ("tempos", "多种速度"),
    ("run", "奔跑"),
    ("car", "汽车"),
    ("cars", "汽车"),
    ("vehicle", "车辆"),
    ("interior", "内部"),
    ("parking", "停车"),
    ("engine", "引擎"),
    ("skid", "急刹打滑"),
    ("skids", "急刹打滑"),
    ("skidding", "打滑"),
    ("tire", "轮胎"),
    ("tires", "轮胎"),
    ("gun", "枪械"),
    ("rifle", "步枪"),
    ("pistol", "手枪"),
    ("bullet", "子弹"),
    ("bullets", "子弹"),
    ("metal", "金属"),
    ("wood", "木材"),
    ("stone", "石材"),
    ("fence", "围栏"),
    ("whoosh", "呼啸转场"),
    ("swoosh", "呼啸转场"),
    ("riser", "上升音"),
    ("drone", "持续氛围"),
    ("beep", "提示音"),
    ("beeps", "提示音"),
    ("click", "点击声"),
    ("clicks", "点击声"),
    ("bell", "钟声"),
    ("bells", "钟声"),
    ("deep", "低沉"),
    ("fast", "快速"),
    ("light", "轻柔"),
    ("heavy", "厚重"),
    ("single", "单次"),
    ("singles", "单次"),
    ("pump", "泵"),
    ("transformer", "变压器"),
    ("spectrometer", "光谱仪"),
    ("detector", "探测器"),
    ("helium", "氦气"),
    ("vacuum", "真空"),
    ("air", "空气"),
    ("escape", "泄压"),
    ("bursts", "爆发"),
    ("data", "数据"),
    ("on", "开启"),
    ("off", "关闭"),
    ("room", "房间"),
    ("marker", "标记"),
    ("hi", "高位声道"),
    ("lo", "低位声道"),
];

const FILLER_WORDS: &[&str] = &["a", "an", "the", "and", "of", "by", "with"];

fn cleaned_tokens(name: &str) -> Vec<String> {
    name.chars()
        .map(|character| {
            if character.is_alphanumeric() || character == '.' {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(|token| token.trim_matches('.').to_string())
        .filter(|token| !token.is_empty())
        .collect()
}

fn phrase_matches(tokens: &[String], index: usize, phrase: &str) -> bool {
    let phrase_tokens: Vec<&str> = phrase.split_whitespace().collect();
    index + phrase_tokens.len() <= tokens.len()
        && tokens[index..index + phrase_tokens.len()]
            .iter()
            .zip(phrase_tokens)
            .all(|(token, phrase_token)| token.eq_ignore_ascii_case(phrase_token))
}

pub fn translate_name(name: &str) -> String {
    let tokens = cleaned_tokens(name);
    let mut translated = Vec::new();
    let mut index = 0;

    while index < tokens.len() {
        if let Some((phrase, chinese)) = PHRASES
            .iter()
            .find(|(phrase, _)| phrase_matches(&tokens, index, phrase))
        {
            translated.push((*chinese).to_string());
            index += phrase.split_whitespace().count();
            continue;
        }

        let token = &tokens[index];
        if FILLER_WORDS
            .iter()
            .any(|filler| token.eq_ignore_ascii_case(filler))
        {
            index += 1;
            continue;
        }
        let replacement = WORDS
            .iter()
            .find_map(|(source, target)| token.eq_ignore_ascii_case(source).then_some(*target));
        let segment = replacement.unwrap_or(token).to_string();
        if translated.last() != Some(&segment) {
            translated.push(segment);
        }
        index += 1;
    }

    translated.join(" · ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn translates_professional_sound_library_phrases() {
        assert_eq!(
            translate_name("3DS02 Car Interior Parking Raining 4.0 Hi"),
            "3DS02 · 雨中停车的车内环境 · 4.0 高位声道"
        );
        assert_eq!(
            translate_name("-035_04 body falls (hard)"),
            "035 · 04 · 身体重摔"
        );
        assert_eq!(translate_name("FIRE--gas tank whoosh"), "燃气罐火焰呼啸");
        assert_eq!(
            translate_name("08 Elephant Footsteps,Fast,Onboard,Close,Many Walking Various"),
            "08 · 多只大象快速行走脚步（贴身近距拾音，多种变化）"
        );
        assert_eq!(
            translate_name("08 Elephant Footsteps,Fast,Onboard,Close,Many Walking Various Tempos"),
            "08 · 多只大象快速行走脚步（贴身近距拾音，多种速度变化）"
        );
    }

    #[test]
    fn preserves_catalog_codes_and_unknown_terms() {
        assert_eq!(translate_name("ZXCV_000192"), "ZXCV · 000192");
    }
}
