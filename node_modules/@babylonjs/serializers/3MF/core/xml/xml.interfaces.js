/**
 * @param x
 * @returns
 */
export function IsQualifiedName(x) {
    return typeof x?.name === "string";
}
const XML_CLASS_META = Symbol("__xml:meta$__");
const XML_CLASS_NAME = Symbol("__xml:name$__");
function AddXmlMeta(target, meta) {
    const ctor = target.constructor;
    (ctor[XML_CLASS_META] ?? (ctor[XML_CLASS_META] = [])).push(meta);
}
/**
 * @param name
 * @returns
 */
export function XmlName(name) {
    return (ctor) => {
        ctor[XML_CLASS_NAME] = name;
    };
}
/**
 * tell the serializer to ignore the property
 * @returns
 */
export function XmlIgnore() {
    return (target, prop) => AddXmlMeta(target, { kind: "none", prop, ignore: true });
}
/**
 * tell the serializer to serialize the property as attribute
 * @returns
 */
export function XmlAttr(opts) {
    return (target, prop) => AddXmlMeta(target, { kind: "attr", prop, ...opts });
}
/**
 * tell the serializer to serialize the property as element - this is the default behavior but shoud be
 * specified when wanted to update the default name of the classe or if the class is not decorated (without \@XmlName)
 * @returns
 */
export function XmlElem(opts) {
    return (target, prop) => AddXmlMeta(target, { kind: "elem", prop, ...opts });
}
/**
 *
 * @param obj
 * @returns
 */
export function GetXmlFieldMeta(obj) {
    return (obj?.constructor?.[XML_CLASS_META] ?? []);
}
/**
 *
 * @param obj
 * @returns
 */
export function GetXmlName(obj) {
    const n = obj?.constructor?.[XML_CLASS_NAME];
    return n ? n : undefined;
}
/**
 *
 * @param s
 * @returns
 */
function LooksLikeXmlNcName(s) {
    // Approximation ASCII de NCName: pas de ":" et demarre par lettre ou underscore
    // Puis lettres/chiffres/underscore/point/tiret.
    return /^[A-Za-z_][A-Za-z0-9._-]*$/.test(s);
}
/**
 *
 * @param qn
 * @returns
 */
export function XmlNameToParts(qn) {
    if (IsQualifiedName(qn)) {
        return qn;
    }
    const s = (qn ?? "").trim();
    if (!s) {
        return { name: "" };
    }
    const i = s.indexOf(":");
    if (i === -1) {
        return { name: s };
    }
    // Un QName XML ne doit contenir qu un seul ":".
    // Si il y en a plusieurs, on considere que ce n est pas un QName.
    if (s.indexOf(":", i + 1) !== -1) {
        return { name: s };
    }
    const prefix = s.slice(0, i);
    const local = s.slice(i + 1);
    if (LooksLikeXmlNcName(prefix) && LooksLikeXmlNcName(local)) {
        return { ns: prefix, name: local };
    }
    return { name: s };
}
/**
 *
 * @param name
 * @param prefix
 * @returns
 */
export function ToQualifiedString(name, prefix) {
    return prefix ? `${prefix}:${name}` : name;
}
//# sourceMappingURL=xml.interfaces.js.map