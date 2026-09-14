#[cfg(not(target_os = "windows")]
use std::io::Cursor;
#[cfg(target_os = "windows")]
use std::thread;
#[cfg(target_os = "windows")]
use std::time::Duration;

#[cfg(not(target_os = "windows"))]
use rodio::{Decoder, OutputStream, Sink};

#[cfg(not(target_os = "windows"))]
const AGENT_ALERT_SOUND: &[u8] = include_bytes!("../../public/agent-sounds/strong.wav");

#[cfg(target_os = "windows")]
#[link(name = "user32")]
unsafe extern "system" {
  fn MessageBeep(sound_type: u32) -> i32;
}

#[tauri::command]
fn play_agent_alert(alert_type: Option<String>) -> Result<(), String> {
  let repeats = if alert_type.as_deref() == Some("NEW_CONVERSATION") {
    3
  } else {
    2
  };

  #[cfg(target_os = "windows")]
  {
    const MB_OK: u32 = 0x00000000;
    const MB_ICONEXCLAMATION: u32 = 0x00000030;
    let sound_type = if alert_type.as_deref() == Some("NEW_CONVERSATION") {
      MB_ICONEXCLAMATION
    } else {
      MB_OK
    };

    for index in 0..repeats {
      let played = unsafe { MessageBeep(sound_type) };
      if played == 0 {
        return Err("Unable to play the Windows system alert sound".to_string());
      }
      if index + 1 < repeats {
        thread::sleep(Duration::from_millis(120));
      }
    }
    return Ok(());
  }

  #[cfg(not(target_os = "windows"))]
  {
    let (_stream, handle) = OutputStream::try_default()
      .map_err(|error| format!("Unable to open the default audio device: {error}"))?;
    let sink = Sink::try_new(&handle)
      .map_err(|error| format!("Unable to create the alert audio sink: {error}"))?;
    for _ in 0..repeats {
      let source = Decoder::new(Cursor::new(AGENT_ALERT_SOUND))
        .map_err(|error| format!("Unable to decode the alert sound: {error}"))?;
      sink.append(source);
      sink.sleep_until_end();
    }
    Ok(())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![play_agent_alert])
    .run(tauri::generate_context!())
    .expect("error while running customer service agent");
}
