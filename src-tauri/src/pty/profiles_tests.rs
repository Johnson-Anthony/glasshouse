//! ssh config parsing.

use super::*;

#[test]
fn ssh_hosts_lists_named_hosts_in_order() {
    let config = "\
# personal
Host alpha beta
    HostName alpha.example.com
    User me
host\tgamma
HOST delta *.internal w?ld
Hostname not-a-host
  Host   alpha   epsilon
Match host zeta
";
    assert_eq!(parse_ssh_hosts(config), ["alpha", "beta", "gamma", "delta", "epsilon"]);
}

#[test]
fn ssh_hosts_of_an_empty_or_wildcard_config_is_empty() {
    assert!(parse_ssh_hosts("").is_empty());
    assert!(parse_ssh_hosts("Host *\n  ServerAliveInterval 30\n").is_empty());
}

// ssh_config(5): a keyword and its arguments are separated by whitespace,
// or by optional whitespace and exactly one `=`.
#[test]
fn ssh_hosts_accepts_an_equals_sign_after_the_keyword() {
    let config = "\
Host=alpha
host = beta gamma
HOST =delta
Host\t=\tepsilon
Host= zeta
";
    assert_eq!(parse_ssh_hosts(config), ["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
}

#[test]
fn ssh_hosts_skips_other_keywords_and_malformed_lines() {
    let config = "\
Hostname=not-a-host
HostKeyAlias = nope
Host==twice
Host = =twice
Host
Host =
Match host=zeta
";
    assert!(parse_ssh_hosts(config).is_empty(), "{:?}", parse_ssh_hosts(config));
}
