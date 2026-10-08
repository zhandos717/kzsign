const MULTI_LABEL_SUFFIXES = ["gov.kz", "com.kz", "org.kz", "edu.kz", "net.kz", "co.uk", "com.ru"];

// Хост показываем в ASCII (punycode не раскрываем — так видна подмена похожими буквами), регистрируемый домен выделяем
export function splitHost(origin: string): { scheme: string; prefix: string; site: string; port: string } {
  const u = new URL(origin);
  const labels = u.hostname.split(".");
  const suffix = MULTI_LABEL_SUFFIXES.find((s) => u.hostname === s || u.hostname.endsWith("." + s));
  const take = suffix ? suffix.split(".").length + 1 : 2;
  const site = labels.slice(-take).join(".");
  const prefix = labels.length > take ? labels.slice(0, -take).join(".") + "." : "";
  return { scheme: u.protocol.replace(":", ""), prefix, site, port: u.port };
}
