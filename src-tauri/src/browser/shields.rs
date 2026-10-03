//! Shields: blocks requests to known ad and tracker servers in the built-in browser,
//! plus light cosmetic cleanup (see shields_script.js). Can be turned off globally or per site.

use std::sync::RwLock;

/// Ad and tracking servers. A request is blocked when its host is one of these or a subdomain.
pub const BLOCKED_DOMAINS: &[&str] = &[
    "google-analytics.com", "googletagmanager.com", "googleadservices.com", "googlesyndication.com",
    "doubleclick.net", "adservice.google.com", "analytics.google.com", "facebook.net", "pixel.facebook.com",
    "scorecardresearch.com", "criteo.com", "criteo.net", "adnxs.com", "rubiconproject.com",
    "taboola.com", "outbrain.com", "revcontent.com", "hotjar.com", "segment.io", "cdn.segment.com",
    "mixpanel.com", "clarity.ms", "nr-data.net", "amazon-adsystem.com",
    "moatads.com", "serving-sys.com", "pubmatic.com", "chartbeat.com", "chartbeat.net", "quantserve.com",
    "adroll.com", "smartadserver.com", "yieldmo.com", "openx.net",
    "bidswitch.net", "casalemedia.com", "media.net", "inmobi.com", "applovin.com", "unityads.unity3d.com",
    "mparticle.com", "crazyegg.com", "static.getclicky.com", "amplitude.com", "adjust.com", "tapjoy.com",
    "tealiumiq.com", "omtrdc.net", "demdex.net", "everesttech.net", "2o7.net", "atdmt.com",
    "advertising.com", "adform.net", "spotxchange.com", "tribalfusion.com", "sovrn.com", "lijit.com",
    "indexexchange.com", "contextweb.com", "rlcdn.com", "pippio.com", "krxd.net",
    "bluekai.com", "exelator.com", "eyeota.net", "lotame.com", "crwdcntrl.net", "tapad.com",
    "adcolony.com", "smaato.net", "33across.com", "sharethrough.com", "teads.tv", "zemanta.com",
    "mgid.com", "propellerads.com", "popads.net", "popcash.net", "adsterra.com", "exoclick.com",
    "juicyads.com", "trafficjunky.net", "hilltopads.net", "adcash.com",
];

struct Config {
    enabled: bool,
    /// Hosts (without "www.") where the user turned Shields off.
    allowed_sites: Vec<String>,
}

static CONFIG: RwLock<Config> = RwLock::new(Config { enabled: true, allowed_sites: Vec::new() });

pub fn site_key(host: &str) -> String {
    host.trim_start_matches("www.").to_ascii_lowercase()
}

pub fn configure(enabled: bool, allowed_sites: &[String]) {
    if let Ok(mut c) = CONFIG.write() {
        c.enabled = enabled;
        c.allowed_sites = allowed_sites.iter().map(|s| site_key(s)).filter(|s| !s.is_empty()).collect();
        c.allowed_sites.sort();
        c.allowed_sites.dedup();
    }
}

/// Whether Shields apply to a page on `host`.
pub fn active_for(host: &str) -> bool {
    CONFIG
        .read()
        .map(|c| c.enabled && !c.allowed_sites.contains(&site_key(host)))
        .unwrap_or(true)
}

fn host_matches(host: &str, domain: &str) -> bool {
    host == domain || host.strip_suffix(domain).is_some_and(|rest| rest.ends_with('.'))
}

/// A request to `request_host` made by a page on `page_host` should be blocked.
pub fn should_block(request_host: &str, page_host: &str) -> bool {
    let request_host = request_host.to_ascii_lowercase();
    let page_host = page_host.to_ascii_lowercase();
    if !active_for(&page_host) {
        return false;
    }
    BLOCKED_DOMAINS
        .iter()
        // Visiting the tracker's own site (e.g. taboola.com) keeps it working.
        .any(|d| host_matches(&request_host, d) && !host_matches(&page_host, d))
}

/// WebView2 request filters (it only calls us for these URLs).
pub fn request_filters() -> Vec<String> {
    BLOCKED_DOMAINS
        .iter()
        .flat_map(|d| [format!("*://{d}/*"), format!("*://*.{d}/*")])
        .collect()
}

/// Settings the page script reads when a document starts.
pub fn page_script_config() -> String {
    let c = CONFIG.read();
    let (enabled, allowed): (bool, Vec<String>) = match c {
        Ok(c) => (c.enabled, c.allowed_sites.clone()),
        Err(_) => (true, Vec::new()),
    };
    format!(
        "window.__HYPERSTREAM_SHIELDS_CONFIG__ = {};",
        serde_json::json!({ "enabled": enabled, "allowedSites": allowed })
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_trackers_but_not_first_party_or_allowed_sites() {
        configure(true, &[]);
        assert!(should_block("stats.g.doubleclick.net", "www.youtube.com"));
        assert!(should_block("www.google-analytics.com", "example.com"));
        assert!(!should_block("notdoubleclick.net", "example.com"));
        assert!(!should_block("www.youtube.com", "www.youtube.com"));
        // The tracker's own site keeps working.
        assert!(!should_block("www.taboola.com", "taboola.com"));

        configure(true, &["www.example.com".to_string()]);
        assert!(!should_block("doubleclick.net", "example.com"));
        assert!(should_block("doubleclick.net", "other.com"));

        configure(false, &[]);
        assert!(!should_block("doubleclick.net", "other.com"));
        configure(true, &[]);
    }

    #[test]
    fn filters_cover_domain_and_subdomains() {
        let f = request_filters();
        assert!(f.contains(&"*://doubleclick.net/*".to_string()));
        assert!(f.contains(&"*://*.doubleclick.net/*".to_string()));
    }
}
