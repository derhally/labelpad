//! Byte-for-byte checks against niimbluelib. Regenerate the fixtures with
//! `node scripts/gen-niimbot.cjs` from the repo root.

use niimbot::encoder::{encode_image, Bitmap};
use niimbot::packet::{Packet, PacketReader};
use niimbot::{generator as gen, models, parser, PrintDirection, PrintTaskName};
use serde_json::Value;

fn fixtures() -> Value {
    serde_json::from_str(include_str!("fixtures/reference.json")).unwrap()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn packet(s: &str) -> Packet {
    Packet::from_bytes(&unhex(s)).unwrap()
}

#[test]
fn request_packets_match() {
    let f = fixtures();
    let ours: Vec<(&str, Packet)> = vec![
        ("connect", gen::connect()),
        ("getPrinterStatusData", gen::printer_status_data()),
        ("getPrinterInfoModel", gen::printer_info(8)),
        ("getPrinterInfoBattery", gen::printer_info(10)),
        ("getPrinterInfoSoftware", gen::printer_info(9)),
        ("getPrinterInfoHardware", gen::printer_info(12)),
        ("heartbeatAdvanced1", gen::heartbeat(1)),
        ("heartbeatAdvanced2", gen::heartbeat(4)),
        ("heartbeatPrinterInfo", gen::heartbeat(3)),
        ("setDensity3", gen::set_density(3)),
        ("setLabelType1", gen::set_label_type(1)),
        ("printStart1b", gen::print_start_1b()),
        ("printClear", gen::print_clear()),
        ("pageStart", gen::page_start()),
        ("setPageSize2b", gen::set_page_size_2b(320)),
        ("setPageSize4b", gen::set_page_size_4b(320, 96)),
        ("setPrintQuantity", gen::set_print_quantity(12)),
        ("pageEnd", gen::page_end()),
        ("printStatus", gen::print_status()),
        ("printEnd", gen::print_end()),
        ("printEmptySpace", gen::print_empty_space(300, 7)),
    ];
    let expected = f["packets"].as_object().unwrap();
    assert_eq!(ours.len(), expected.len(), "every fixture packet is covered");
    for (name, p) in ours {
        assert_eq!(hex(&p.to_bytes()), expected[name].as_str().unwrap(), "{name}");
    }
}

#[test]
fn image_data_matches() {
    let f = fixtures();
    for img in f["images"].as_array().unwrap() {
        let name = img["name"].as_str().unwrap();
        let bitmap = Bitmap::from_packed(
            img["width"].as_u64().unwrap() as u32,
            img["height"].as_u64().unwrap() as u32,
            &unhex(img["pixels"].as_str().unwrap()),
        );
        let dir = if img["direction"] == "left" { PrintDirection::Left } else { PrintDirection::Top };
        let encoded = encode_image(&bitmap, dir);
        assert_eq!(encoded.rows as u64, img["rows"].as_u64().unwrap(), "{name} rows");
        assert_eq!(encoded.cols as u64, img["cols"].as_u64().unwrap(), "{name} cols");

        let ours: Vec<String> = gen::write_image_data(&encoded, img["printhead_pixels"].as_u64().unwrap() as u16)
            .iter()
            .map(|p| hex(&p.to_bytes()))
            .collect();
        let theirs: Vec<&str> = img["packets"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(ours.len(), theirs.len(), "{name} packet count");
        for (i, (a, b)) in ours.iter().zip(&theirs).enumerate() {
            assert_eq!(a, b, "{name} packet {i}");
        }
    }
}

#[test]
fn parsers_match() {
    let f = fixtures();
    let cases = f["parsers"].as_object().unwrap();
    let case = |k: &str| (packet(cases[k]["packet"].as_str().unwrap()), cases[k]["result"].clone(), cases[k]["model_id"].as_u64());

    for k in ["heartbeat_advanced1_d11_10", "heartbeat_advanced1_13", "heartbeat_advanced1_19"] {
        let (p, r, model) = case(k);
        let h = parser::heartbeat_advanced1(&p, model.map(|m| m as u16)).unwrap();
        assert_eq!(h.lid_closed, r["lidClosed"].as_bool(), "{k} lid");
        assert_eq!(h.battery_percents.map(u64::from), r["batteryPercents"].as_u64(), "{k} battery");
        assert_eq!(h.paper_inserted, r["paperInserted"].as_bool(), "{k} paper");
    }

    let (p, r, _) = case("heartbeat_advanced2");
    let h = parser::heartbeat_advanced2(&p).unwrap();
    assert_eq!(h.battery_percents.map(u64::from), r["batteryPercents"].as_u64());
    assert_eq!(h.lid_closed, r["lidClosed"].as_bool());
    assert_eq!(h.paper_inserted, r["paperInserted"].as_bool());

    let (p, r, _) = case("heartbeat_printer_info");
    let i = parser::heartbeat_printer_info(&p).unwrap();
    assert_eq!(i.software_version, r["softwareVersion"].as_str().unwrap());
    assert_eq!(i.hardware_version, r["hardwareVersion"].as_str().unwrap());
    assert_eq!(i.printhead_width as u64, r["printheadWidth"].as_u64().unwrap());

    for k in ["print_status_4", "print_status_10"] {
        let (p, r, _) = case(k);
        let s = parser::print_status(&p).unwrap();
        assert_eq!(s.page as u64, r["page"].as_u64().unwrap(), "{k}");
        assert_eq!(s.page_print_progress as u64, r["pagePrintProgress"].as_u64().unwrap(), "{k}");
        assert_eq!(s.error as u64, r["error"].as_u64().unwrap(), "{k}");
    }

    for k in ["printer_status_data_v3", "printer_status_data_v5"] {
        let (p, r, _) = case(k);
        let (v, color) = parser::printer_status_data(&p);
        assert_eq!(v as u64, r["protocolVersion"].as_u64().unwrap(), "{k}");
        assert_eq!(color, r["supportColor"].as_bool().unwrap(), "{k}");
    }

    for k in ["model_id_1b", "model_id_2b"] {
        let (p, r, _) = case(k);
        assert_eq!(parser::model_id(&p).unwrap() as u64, r.as_u64().unwrap(), "{k}");
    }
    let (p, r, _) = case("battery");
    assert_eq!(parser::battery_level(&p).unwrap() as u64, r.as_u64().unwrap());
    let (p, r, _) = case("version");
    assert_eq!(parser::version(&p).unwrap(), r.as_str().unwrap());
}

#[test]
fn reader_reassembles_split_stream() {
    let f = fixtures();
    let stream = unhex(f["bundle"]["hex"].as_str().unwrap());
    let expected: Vec<&str> = f["bundle"]["packets"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    for split in 1..stream.len() {
        let mut r = PacketReader::default();
        let mut got = r.push(&stream[..split]);
        got.extend(r.push(&stream[split..]));
        let got: Vec<String> = got.iter().map(|p| hex(&p.to_bytes())).collect();
        assert_eq!(got, expected, "split at {split}");
    }
}

#[test]
fn d11_task_lookup() {
    let d11 = models::find_model(512).expect("D11 is model 512");
    assert_eq!(d11.model, "D11");
    assert_eq!(d11.printhead_pixels, 96);
    assert_eq!(models::find_print_task("D11", Some(0)), Some(PrintTaskName::D11V1));
    assert_eq!(models::find_print_task("D11", Some(1)), Some(PrintTaskName::D110));
    assert_eq!(models::find_print_task("D11", Some(3)), Some(PrintTaskName::D11V1));
    assert_eq!(models::find_print_task("D110", None), Some(PrintTaskName::D110));
}
