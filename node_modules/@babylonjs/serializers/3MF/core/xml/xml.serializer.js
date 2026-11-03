import { XmlNameToParts, GetXmlName, ToQualifiedString, GetXmlFieldMeta } from "./xml.interfaces.js";
import { NumberFormatter, ResolveFormatOptions } from "./xml.serializer.format.js";
function IsDate(x) {
    return x instanceof Date;
}
function IsString(x) {
    return typeof x === "string";
}
function IsNumber(x) {
    return typeof x === "number";
}
function IsPrimitive(x) {
    return typeof x === "string" || typeof x === "number" || typeof x === "boolean" || typeof x === "bigint" || IsDate(x);
}
function IsPrimitiveButString(x) {
    return typeof x === "number" || typeof x === "boolean" || typeof x === "bigint" || IsDate(x);
}
/**
 */
export class XmlSerializer {
    /**
     *
     * @param builder
     * @param format
     */
    constructor(builder, format) {
        /** */
        this._ns = new Map();
        /** */
        this._prefixCount = 0;
        this._builder = builder;
        this._format = ResolveFormatOptions(format);
        this._nFmt = new NumberFormatter(this._format);
    }
    /**
     *
     * @param ns
     * @returns
     */
    withNamespace(...ns) {
        for (const s of ns) {
            this._assignNamespace(s);
        }
        return this;
    }
    /**
     *
     * @param root
     * @param name
     */
    serialize(root, name) {
        name = name ?? GetXmlName(root);
        if (!name) {
            throw new Error("can not find name for given object");
        }
        const currentName = XmlNameToParts(name);
        if (currentName.ns) {
            // ensure we register the root namespace as default if not already set...
            this._assignNamespace(currentName.ns, "xmlns");
        }
        this._gatherNamespaces(root, new WeakSet());
        const doc = this._builder.ele(null, currentName.name);
        for (const [v, n] of Array.from(this._ns.entries())) {
            doc.att("xmlns", n, v);
        }
        this._writeObjectContent(doc, root, new WeakSet().add(root));
        this._builder.end();
    }
    _writeObject(builder, source, visited) {
        if (visited.has(source)) {
            return;
        }
        visited.add(source);
        if (Array.isArray(source)) {
            for (const item of source) {
                if (IsPrimitiveButString(item)) {
                    continue;
                }
                if (IsString(item)) {
                    this._builder.text(item);
                    continue;
                }
                this._writeObject(builder, item, visited);
            }
            return;
        }
        const qname = GetXmlName(source);
        if (!qname) {
            return;
        }
        const currentName = XmlNameToParts(qname);
        const prefix = this._getPrefix(currentName);
        const tmp = ToQualifiedString(currentName.name, prefix);
        builder.ele(null, tmp);
        this._writeObjectContent(builder, source, visited);
        this._builder.end();
    }
    _getPrefix(qn) {
        if (qn.ns) {
            const p = this._ns.get(qn.ns.toLowerCase());
            if (p !== "xmlns") {
                return p;
            }
        }
        return undefined;
    }
    _writeObjectContent(builder, source, visited) {
        // gather meta and build index
        const metas = GetXmlFieldMeta(source) ?? [];
        const metaByProp = new Map();
        for (const m of metas) {
            const arr = metaByProp.get(m.prop) ?? [];
            arr.push(m);
            metaByProp.set(m.prop, arr);
        }
        // ensure the att are processed first, otherwize, the tag might be closed...
        const keys = Object.keys(source).sort((a, b) => {
            const aHasAttr = (metaByProp.get(a) ?? []).some((m) => m.kind === "attr");
            const bHasAttr = (metaByProp.get(b) ?? []).some((m) => m.kind === "attr");
            if (aHasAttr === bHasAttr) {
                return 0;
            }
            return aHasAttr ? -1 : 1; // attr d abord
        });
        // We decide per property, using metadata if present
        for (const prop of keys) {
            const value = source[prop];
            if (value === null || value === undefined) {
                continue;
            }
            const propMetas = metaByProp.get(prop);
            if (propMetas) {
                const ignored = propMetas.some((m) => m.ignore === true || m.kind === "none");
                if (ignored) {
                    continue;
                }
                for (const m of propMetas) {
                    const name = m.name ?? m.prop.toLowerCase(); // if the name is not defined, we assume it's the lower case version of name of the property.
                    if (name) {
                        switch (m.kind) {
                            case "attr": {
                                let vStr = null;
                                if (IsNumber(value) && this._nFmt) {
                                    vStr = this._nFmt.toString(value);
                                }
                                if (m.formatter) {
                                    // TODO : cache the created formatter to avoid to many allocation.
                                    const f = new m.formatter(this._format);
                                    vStr = f.toString(value);
                                }
                                vStr = vStr ?? value.toString();
                                if (vStr) {
                                    const currentName = XmlNameToParts(name);
                                    const prefix = this._getPrefix(currentName);
                                    const tmp = ToQualifiedString(currentName.name, prefix);
                                    builder.att(null, tmp, vStr);
                                }
                                break;
                            }
                        }
                    }
                }
                continue;
            }
            if (IsPrimitiveButString(value)) {
                continue;
            }
            if (IsString(value)) {
                this._builder.text(value);
                continue;
            }
            this._writeObject(builder, value, visited);
        }
    }
    // this is the first browse of the hierarchy to collect the namespaces and assign placeholder.( ns0, ns1,...)
    _gatherNamespaces(tag, visited) {
        if (visited.has(tag)) {
            return;
        }
        visited.add(tag);
        if (Array.isArray(tag)) {
            for (const item of tag) {
                if (IsPrimitive(item)) {
                    continue;
                }
                this._gatherNamespaces(item, visited);
            }
            return;
        }
        const qname = GetXmlName(tag);
        if (qname) {
            this._assignNamespace(qname);
        }
        // gather meta and build index
        const metas = GetXmlFieldMeta(tag) ?? [];
        const metaByProp = new Map();
        for (const m of metas) {
            const arr = metaByProp.get(m.prop) ?? [];
            arr.push(m);
            metaByProp.set(m.prop, arr);
        }
        // We decide per property, using metadata if present
        const toVisit = [];
        for (const prop of Object.keys(tag)) {
            const value = tag[prop];
            if (value === null || value === undefined) {
                continue;
            }
            const propMetas = metaByProp.get(prop);
            if (propMetas) {
                const ignored = propMetas.some((m) => m.ignore === true || m.kind === "none");
                if (ignored) {
                    continue;
                }
                for (const m of propMetas) {
                    if (m.name) {
                        this._assignNamespace(m.name);
                    }
                }
            }
            toVisit.push(value);
        }
        for (const v of toVisit) {
            if (IsPrimitive(v)) {
                continue;
            }
            this._gatherNamespaces(v, visited);
        }
    }
    _assignNamespace(qn, prefix) {
        const nqn = XmlNameToParts(qn);
        if (nqn?.ns) {
            const ns = nqn.ns.toLowerCase();
            if (!this._ns.get(ns)) {
                this._ns.set(ns, prefix ?? this._buildNsPrefix(ns));
            }
            return;
        }
        if (prefix === "xmlns") {
            const ns = nqn.name.toLowerCase();
            if (!this._ns.get(ns)) {
                this._ns.set(ns, prefix ?? this._buildNsPrefix(ns));
            }
        }
    }
    _buildNsPrefix(_ns) {
        let alreadyReferenced = false;
        let value;
        do {
            value = `ns${this._prefixCount++}`;
            for (const v of Array.from(this._ns.values())) {
                if (v === value) {
                    alreadyReferenced = true;
                    break;
                }
            }
        } while (alreadyReferenced);
        return value;
    }
}
//# sourceMappingURL=xml.serializer.js.map