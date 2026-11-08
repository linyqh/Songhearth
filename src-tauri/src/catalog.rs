//! Curated music models supported by the app. Each entry maps to an
//! audio.cpp GGUF package and declares the controls the UI/API expose.

use serde::Serialize;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct License {
    pub name: &'static str,
    /// `yes` | `no` | `conditional`
    pub commercial: &'static str,
    pub note: &'static str,
    pub url: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFile {
    /// Path inside the Hugging Face repo.
    pub remote: &'static str,
    /// Path relative to the models directory.
    pub local: &'static str,
    pub size: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurationSpec {
    pub min: f64,
    pub max: f64,
    pub default: f64,
    /// `exact`: output is trimmed to the value. `max`: the song may end
    /// earlier (lyrics drive the length).
    pub mode: &'static str,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StepsSpec {
    pub min: u32,
    pub max: u32,
    pub default: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDef {
    pub id: &'static str,
    pub name: &'static str,
    pub vendor: &'static str,
    pub family: &'static str,
    pub summary: &'static str,
    pub description: &'static str,
    pub tags: Vec<&'static str>,
    pub vocals: bool,
    pub instrumental: bool,
    pub lyrics_required: bool,
    pub languages: &'static str,
    pub prompt_hint: &'static str,
    pub prompt_example: &'static str,
    pub license: License,
    pub repo: &'static str,
    pub files: Vec<ModelFile>,
    /// Path passed to `--model`, relative to the models directory.
    pub model_arg: &'static str,
    #[serde(skip)]
    pub session_options: Vec<(&'static str, &'static str)>,
    /// 1..=5, used for ordering and the UI rating bars.
    pub quality: u8,
    pub speed: u8,
    pub memory_gb: f64,
    pub duration: DurationSpec,
    pub steps: Option<StepsSpec>,
    pub supports_cot: bool,
    pub supports_negative_prompt: bool,
    /// Can re-sing a reference song (cover route): takes `--audio` as input.
    pub supports_source_audio: bool,
    pub recommended_for: Vec<&'static str>,
    /// Seconds of compute per second of audio on Apple Silicon (initial guess;
    /// replaced by measured values after the first run).
    #[serde(skip)]
    pub compute_factor: f64,
}

impl ModelDef {
    pub fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }
}

pub fn catalog() -> Vec<ModelDef> {
    let file = |remote: &'static str, local: &'static str, size: u64| ModelFile { remote, local, size };
    let yue2_files = vec![
        file("sidecars/yue2-generation-config.json", "Yue2-3B-GGUF/sidecars/yue2-generation-config.json", 466),
        file("sidecars/yue2-model-config.json", "Yue2-3B-GGUF/sidecars/yue2-model-config.json", 959),
        file("sidecars/yue2-qwen.tiktoken", "Yue2-3B-GGUF/sidecars/yue2-qwen.tiktoken", 2_561_218),
        file("sidecars/yue2-vae-config.json", "Yue2-3B-GGUF/sidecars/yue2-vae-config.json", 1_378),
        file("yue2-3b-q4_0.gguf", "Yue2-3B-GGUF/yue2-3b-q4_0.gguf", 2_665_641_504),
        file("yue2-vae-f16.gguf", "Yue2-3B-GGUF/yue2-vae-f16.gguf", 265_218_656),
    ];
    let mm3 = file;

    vec![
        ModelDef {
            id: "yue2-3b",
            name: "YuE2 3B",
            vendor: "M-A-P · HKUST",
            family: "yue2",
            summary: "Top-tier open-source song quality; vocals and backing in one pass",
            description: "Highest open-source score on WildSongBench (self-reported; comparable to Suno v5). Chinese and English lyrics; leave the lyrics empty for an instrumental. Q4 quantisation uses about 10 GB of memory on Apple Silicon; song length follows the lyrics.",
            tags: vec!["Vocals", "Instrumental", "Chinese", "English"],
            vocals: true,
            instrumental: true,
            lyrics_required: false,
            languages: "Chinese, English",
            prompt_hint: "English tags work best, comma-separated: language, genre, instruments, vocals.",
            prompt_example: "Mandarin, city pop, groovy bass, electric guitar, synth, female vocal, neon night",
            license: License {
                name: "CC BY-NC 4.0",
                commercial: "no",
                note: "Non-commercial use only",
                url: "https://huggingface.co/m-a-p/YuE2-3B",
            },
            repo: "audio-cpp/Yue2-3B-GGUF",
            files: yue2_files,
            model_arg: "Yue2-3B-GGUF",
            session_options: vec![
                ("yue2.model_gguf", "yue2-3b-q4_0.gguf"),
                ("yue2.vae_gguf", "yue2-vae-f16.gguf"),
            ],
            quality: 5,
            speed: 2,
            memory_gb: 10.0,
            duration: DurationSpec { min: 30.0, max: 300.0, default: 180.0, mode: "max" },
            steps: Some(StepsSpec { min: 4, max: 16, default: 8 }),
            supports_cot: true,
            supports_negative_prompt: false,
            supports_source_audio: false,
            recommended_for: vec!["vocals"],
            compute_factor: 0.65,
        },
        ModelDef {
            id: "ace-step-1.5-turbo",
            name: "ACE-Step 1.5 Turbo",
            vendor: "ACE Studio · StepFun",
            family: "ace_step",
            summary: "Fastest; MIT-licensed for commercial use; 50+ lyric languages",
            description: "Planner + diffusion hybrid that renders a song in 8 steps. Trained on licensed, royalty-free and synthetic music, so output is commercially usable. Can also re-sing a reference song with new lyrics (cover). Full BF16 build (quantising breaks the planner's sampling), about 10 GB on disk.",
            tags: vec!["Vocals", "Instrumental", "Multilingual", "Commercial use"],
            vocals: true,
            instrumental: true,
            lyrics_required: false,
            languages: "50+ languages",
            prompt_hint: "Describe style, mood, instruments and vocals in natural language, in English or Chinese.",
            prompt_example: "upbeat synth pop, bright female vocal, punchy drums, summer night drive",
            license: License {
                name: "MIT",
                commercial: "yes",
                note: "Commercial use allowed",
                url: "https://huggingface.co/ACE-Step/Ace-Step1.5",
            },
            repo: "audio-cpp/audio.cpp-gguf",
            files: vec![ModelFile {
                remote: "ACE-Step1.5-GGUF/turbo/ace-step-1.5-turbo-bf16.gguf",
                local: "ACE-Step1.5-GGUF/turbo/ace-step-1.5-turbo-bf16.gguf",
                size: 10_090_406_336,
            }],
            model_arg: "ACE-Step1.5-GGUF/turbo",
            session_options: vec![("ace_step.mem_saver", "true")],
            quality: 4,
            speed: 5,
            memory_gb: 14.0,
            duration: DurationSpec { min: 10.0, max: 480.0, default: 120.0, mode: "exact" },
            steps: None,
            supports_cot: false,
            supports_negative_prompt: true,
            supports_source_audio: true,
            recommended_for: vec!["commercial", "fast"],
            compute_factor: 0.2,
        },
        ModelDef {
            id: "minimax-music-3",
            name: "MiniMax Music 3",
            vendor: "MiniMax",
            family: "minimax_music3",
            summary: "Top open model in third-party blind tests; full songs up to 5 minutes",
            description: "The only open model on the Artificial Analysis vocal leaderboard (Elo 1000). 8B global LLM + 0.6B local LLM + flow matching, 32 kHz stereo. Lyrics are required; best for fully structured pop songs.",
            tags: vec!["Vocals", "Chinese", "English", "Long songs"],
            vocals: true,
            instrumental: false,
            lyrics_required: true,
            languages: "Auto-detected",
            prompt_hint: "Write a detailed music description: genre, BPM, key, emotional arc, vocals and arrangement.",
            prompt_example: "A warm acoustic pop song with intimate female vocals, fingerpicked guitar, soft piano and a gradual build into a wide final chorus.",
            license: License {
                name: "MiniMax Music3 Community License",
                commercial: "conditional",
                note: "The model name must be shown in your product UI; written authorisation is needed above USD 20M annual revenue; public content must be labelled as AI-generated",
                url: "https://huggingface.co/MiniMaxAI/MiniMax-Music3/blob/main/LICENSE",
            },
            repo: "audio-cpp/MiniMax-Music3-GGUF",
            files: vec![
                mm3("config.json", "MiniMax-Music3-GGUF/config.json", 107),
                mm3("config/language_model.json", "MiniMax-Music3-GGUF/config/language_model.json", 1_596),
                mm3("config/rvq_depth_decoder.json", "MiniMax-Music3-GGUF/config/rvq_depth_decoder.json", 274),
                mm3("config/condition_encoder.json", "MiniMax-Music3-GGUF/config/condition_encoder.json", 292),
                mm3("config/transformer.json", "MiniMax-Music3-GGUF/config/transformer.json", 294),
                mm3("config/vocoder.json", "MiniMax-Music3-GGUF/config/vocoder.json", 251),
                mm3("tokenizer/tokenizer.json", "MiniMax-Music3-GGUF/tokenizer/tokenizer.json", 11_423_801),
                mm3("tokenizer/tokenizer_config.json", "MiniMax-Music3-GGUF/tokenizer/tokenizer_config.json", 377),
                mm3("language_model_q4_0.gguf", "MiniMax-Music3-GGUF/language_model_q4_0.gguf", 6_006_866_496),
                mm3("rvq_depth_decoder_q8_0.gguf", "MiniMax-Music3-GGUF/rvq_depth_decoder_q8_0.gguf", 714_028_960),
                mm3("condition_encoder.gguf", "MiniMax-Music3-GGUF/condition_encoder.gguf", 100_678_368),
                mm3("transformer_q4_0.gguf", "MiniMax-Music3-GGUF/transformer_q4_0.gguf", 1_396_392_768),
                mm3("vocoder.gguf", "MiniMax-Music3-GGUF/vocoder.gguf", 216_705_376),
            ],
            model_arg: "MiniMax-Music3-GGUF",
            session_options: vec![],
            quality: 4,
            speed: 2,
            memory_gb: 12.0,
            duration: DurationSpec { min: 10.0, max: 300.0, default: 120.0, mode: "max" },
            steps: Some(StepsSpec { min: 10, max: 50, default: 30 }),
            supports_cot: false,
            supports_negative_prompt: false,
            supports_source_audio: false,
            recommended_for: vec!["long"],
            compute_factor: 1.5,
        },
        ModelDef {
            id: "stable-audio-3-medium",
            name: "Stable Audio 3 Medium",
            vendor: "Stability AI",
            family: "stable_audio",
            summary: "Best instrumental quality; a whole BGM track in seconds",
            description: "2nd on the CMU Music Arena instrumental board (behind Lyria 3 Pro). Instrumentals only, no lyrics. Ideal for scores, BGM and ambient music; prompts must be in English.",
            tags: vec!["Instrumental", "BGM", "English prompts"],
            vocals: false,
            instrumental: true,
            lyrics_required: false,
            languages: "English prompts",
            prompt_hint: "Describe genre, instruments, mood and BPM in English, e.g. cinematic, 90 BPM.",
            prompt_example: "wide cinematic ambient music with soft piano, evolving strings, 80 BPM",
            license: License {
                name: "Stability AI Community License",
                commercial: "conditional",
                note: "Free for commercial use below USD 1M annual revenue; see the official licence",
                url: "https://huggingface.co/stabilityai/stable-audio-3-medium",
            },
            repo: "audio-cpp/audio.cpp-gguf",
            files: vec![ModelFile {
                remote: "Stable-Audio-3-Medium-GGUF/stable-audio-3-medium-q8_0.gguf",
                local: "Stable-Audio-3-Medium-GGUF/stable-audio-3-medium-q8_0.gguf",
                size: 3_582_601_408,
            }],
            model_arg: "Stable-Audio-3-Medium-GGUF",
            session_options: vec![],
            quality: 4,
            speed: 5,
            memory_gb: 11.0,
            duration: DurationSpec { min: 5.0, max: 190.0, default: 60.0, mode: "exact" },
            steps: Some(StepsSpec { min: 4, max: 50, default: 8 }),
            supports_cot: false,
            supports_negative_prompt: true,
            supports_source_audio: false,
            recommended_for: vec!["instrumental"],
            compute_factor: 0.1,
        },
        ModelDef {
            id: "stable-audio-3-small",
            name: "Stable Audio 3 Small",
            vendor: "Stability AI",
            family: "stable_audio",
            summary: "Lightest at 1.7 GB; quick demos and loops",
            description: "The small Stable Audio 3 music model: runs in about 4 GB of memory and is very fast, with lower quality than Medium. Instrumentals only; prompts must be in English.",
            tags: vec!["Instrumental", "Lightweight", "English prompts"],
            vocals: false,
            instrumental: true,
            lyrics_required: false,
            languages: "English prompts",
            prompt_hint: "Describe genre, instruments, mood and BPM in English.",
            prompt_example: "uplifting house music with bright synths and festival drums, 124 BPM",
            license: License {
                name: "Stability AI Community License",
                commercial: "conditional",
                note: "Free for commercial use below USD 1M annual revenue; see the official licence",
                url: "https://huggingface.co/stabilityai/stable-audio-3-small-music",
            },
            repo: "audio-cpp/audio.cpp-gguf",
            files: vec![ModelFile {
                remote: "Stable-Audio-3-Small-Music-GGUF/stable-audio-3-small-music-q8_0.gguf",
                local: "Stable-Audio-3-Small-Music-GGUF/stable-audio-3-small-music-q8_0.gguf",
                size: 1_683_576_608,
            }],
            model_arg: "Stable-Audio-3-Small-Music-GGUF",
            session_options: vec![],
            quality: 2,
            speed: 5,
            memory_gb: 4.0,
            duration: DurationSpec { min: 5.0, max: 190.0, default: 30.0, mode: "exact" },
            steps: Some(StepsSpec { min: 4, max: 50, default: 8 }),
            supports_cot: false,
            supports_negative_prompt: true,
            supports_source_audio: false,
            recommended_for: vec!["fast"],
            compute_factor: 0.05,
        },
    ]
}
