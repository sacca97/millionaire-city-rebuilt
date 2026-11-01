//! Self-signed certificates for the HTTPS listeners (serverApp.ts:`createLocalhostTlsOptions`, facebookShim.ts).
//! The TS server generates RSA-2048 / SHA-256 keys (`selfsigned`). `rcgen` (ring) cannot generate RSA keys, so the key is
//! generated with the `rsa` crate and handed to rcgen as PKCS#8. Same subject, SANs, EKU, 365-day lifetime
//! (not-before = now - 5 min, Apple's 398-day limit).

use rcgen::{CertificateParams, DistinguishedName, DnType, ExtendedKeyUsagePurpose, IsCa, KeyPair, KeyUsagePurpose, SanType, PKCS_RSA_SHA256};
use rsa::pkcs8::EncodePrivateKey;
use rsa::RsaPrivateKey;
use rustls::pki_types::PrivatePkcs8KeyDer;
use std::net::{IpAddr, Ipv4Addr};

pub struct Pem {
    pub cert_der: Vec<u8>,
    pub key_der: Vec<u8>,
}

/// `dns_names` become DNS SANs; 127.0.0.1 is always added.
pub fn self_signed(common_name: &str, dns_names: &[&str]) -> Result<Pem, String> {
    let mut params = CertificateParams::default();
    let mut dn = DistinguishedName::new();
    dn.push(DnType::CommonName, common_name);
    dn.push(DnType::OrganizationName, "Millionaire City Revival");
    params.distinguished_name = dn;
    let mut sans = Vec::new();
    for name in dns_names {
        sans.push(SanType::DnsName((*name).try_into().map_err(|e| format!("bad SAN {name}: {e:?}"))?));
    }
    sans.push(SanType::IpAddress(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
    params.subject_alt_names = sans;
    let now = time::OffsetDateTime::now_utc();
    params.not_before = now - time::Duration::minutes(5);
    params.not_after = now + time::Duration::days(365);
    params.is_ca = IsCa::ExplicitNoCa;
    params.key_usages = vec![KeyUsagePurpose::DigitalSignature, KeyUsagePurpose::KeyEncipherment];
    params.extended_key_usages = vec![ExtendedKeyUsagePurpose::ServerAuth];
    let rsa_key = RsaPrivateKey::new(&mut rand::rngs::OsRng, 2048).map_err(|e| e.to_string())?;
    let pkcs8 = rsa_key.to_pkcs8_der().map_err(|e| e.to_string())?;
    let key = KeyPair::from_pkcs8_der_and_sign_algo(&PrivatePkcs8KeyDer::from(pkcs8.as_bytes()), &PKCS_RSA_SHA256)
        .map_err(|e| e.to_string())?;
    let cert = params.self_signed(&key).map_err(|e| e.to_string())?;
    Ok(Pem { cert_der: cert.der().to_vec(), key_der: key.serialize_der() })
}
