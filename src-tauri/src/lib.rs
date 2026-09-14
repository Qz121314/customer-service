use std::io::Cursor;

use rodio::{Decoder, OutputStream, Sink};

const AGENT_ALERT_SOUND: &[u8] = include_bytes!("../../public/agent-sounds/strong.wav");

#[tauri::command]
fn play_agent_alert(alert_type: Option<String>) -> Result<(), String> {
  let repeats = if alert_type.as_deref() == Some("NEW_CONVERSATION") {
    3
  } else {
    2
  };
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![play_agent_alert])
    .run(tauri::generate_context!())
    .expect("error while running customer service agent");
}
