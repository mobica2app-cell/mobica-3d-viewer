import { type IXmlBuilder, type XmlName } from "./xml.interfaces.js";
import { type IXmlSerializerFormatOptions } from "./xml.serializer.format.js";
/**
 */
export declare class XmlSerializer {
    /** */
    private _format;
    /** */
    private _builder;
    /** */
    private _ns;
    /** */
    private _prefixCount;
    private _nFmt?;
    /**
     *
     * @param builder
     * @param format
     */
    constructor(builder: IXmlBuilder, format?: IXmlSerializerFormatOptions);
    /**
     *
     * @param ns
     * @returns
     */
    withNamespace(...ns: XmlName[]): XmlSerializer;
    /**
     *
     * @param root
     * @param name
     */
    serialize(root: object, name?: XmlName): void;
    private _writeObject;
    private _getPrefix;
    private _writeObjectContent;
    private _gatherNamespaces;
    private _assignNamespace;
    private _buildNsPrefix;
}
