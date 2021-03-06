import * as ts from "typescript";
import {Statement} from "typescript";
import {createConst, createInterface, createStatement, Options} from "./swagger";

export interface Block {
    displayName: string;
    statements: Statement[];
    variables: { [index: string]: string };
    hasPathParams: boolean;
    hasBody: boolean;
}

export interface ParseOutput {
    modules: Block[];
    definitions: Block[];
}

export function parse(json: SwaggerInput, options: Options): ParseOutput {
    const parsed = parseJson();

    const modules = parsed.map((item): Block => {
        const vars = Object
            .keys(item.variables)
            .map((key) => [key, item.variables[key]])
            .map(([name, value]) => {
                return createStatement(createConst(name, value));
            });

        const responses = item.responses;
        const responseUnion = getResponseUnion(responses);

        const body = (item.body.members.length > 0) ? item.body : null;
        const pathParms = (item.pathParams.members.length > 0) ? item.pathParams : null;
        const statements = [...vars, pathParms, body, responseUnion, ...responses].filter(Boolean);

        return {
            displayName: item.displayName,
            hasBody: body ? true : false,
            hasPathParams: pathParms ? true : false,
            statements,
            variables: item.variables,
        };
    });

    if (!json.definitions) {
        json.definitions = {};
    }
    const definitions = Object
        .keys(json.definitions)
        .map((key) => {
            const name = NonWordToCamelCase(key);
            const members = getParamsFromObject([json.definitions[key] as any], true);
            const int = createInterface(name, members);
            return int;
        });

    return {
        definitions: [{
            displayName: options.defName,
            hasBody: false,
            hasPathParams: false,
            statements: definitions,
            variables: {},
        }],
        modules,
    };

    function parseJson() {
        return Object
            .keys(json.paths)
            .map((key) => ({key, current: json.paths[key]}))
            .reduce((acc, {key, current}) => {
                return acc.concat(Object
                    .keys(current)
                    .map((methodType: MethodKeys) => {
                        const item: MethodItem | PathItemParam[] = current[methodType];
                        const name = Array.isArray(item)
                            ? generatePathParametersName(item)
                            : generatePathMethodName(item, methodType);
                        const bodyItems = (item.parameters || [])
                            .map((x) => {
                                if (x.in === "body") {
                                    return x.schema;
                                }
                            })
                            .filter(Boolean);

                        const bodyMembers = getParamsFromObject(bodyItems);
                        const pathItems = (item.parameters || [])
                            .map((x) => {
                                if (x.in === "path") {
                                    return x;
                                }
                            })
                            .filter(Boolean);

                        return {
                            body: createInterface("Body", bodyMembers),
                            displayName: upper(name),
                            method: methodType,
                            pathParams: getPathMembers(pathItems),
                            responses: getResponses(item.responses),
                            variables: {
                                description: item.description,
                                method: methodType.toUpperCase(),
                                operationId: item.operationId,
                                path: key,
                            },
                        };
                    }));
            }, []);
    }

    function NonWordToCamelCase(input) {
        return input.split(/[\W|_]/g).filter(Boolean).map((x) => upper(x)).join("");
    }

    function upper(input) {
        return input[0].toUpperCase() + input.slice(1);
    }

    function getPathMembers(items: PathParam[]) {
        const members = items.map((item) => {
            return resolveItem(item.name, item, [item.name]);
        });
        const inter = createInterface("PathParams", members);
        return inter;
    }

    function getResponseUnion(responses) {
        const node: any = ts.createNode(ts.SyntaxKind.TypeAliasDeclaration);
        node.modifiers = [ts.createToken(ts.SyntaxKind.ExportKeyword)];
        node.name = ts.createIdentifier("Response");
        node.type = ts.createUnionOrIntersectionTypeNode(
            ts.SyntaxKind.UnionType,
            responses.map((resp) => ts.createTypeReferenceNode(resp.name.escapedText, undefined)),
        );
        return node;
    }

    function getResponses(responses: { [K in ResponseCode]: IResponsesItem}) {
        return Object.keys(responses).map((code) => {
            const current = responses[code];
            const schema: IDefinitionsItemProperties = current.schema;
            const typeName = Number.isNaN(Number(code))
                ? `Response${upper(code)}`
                : `Response${code}`;
            if (!schema) {
                return false;
            } else if (schema["$ref"]) {
                const dashRefName = interfaceNameFromRef(schema["$ref"]);
                const node: any = ts.createNode(ts.SyntaxKind.TypeAliasDeclaration);
                node.modifiers = [ts.createToken(ts.SyntaxKind.ExportKeyword)];
                return getDefinitionReference(node, typeName, dashRefName);
            } else {
                return resolveFromTopLevelSchema(typeName, schema, false);
            }
        }).filter(Boolean);
    }

    function getDefinitionReference(node, name, refName, isLocal = false) {
        const leftName = ts.createIdentifier(options.defName);
        node.type = ts.createTypeReferenceNode(refName, undefined);
        if (!isLocal) {
            node.type.typeName = ts.createQualifiedName(leftName, refName);
        }
        node.name = ts.createIdentifier(name);
        return node;
    }

    function resolveFromTopLevelSchema(name, input: IDefinitionsItemProperties, isLocal = false) {
        const node: any = ts.createNode(ts.SyntaxKind.TypeAliasDeclaration);
        node.modifiers = [ts.createToken(ts.SyntaxKind.ExportKeyword)];
        node.name = ts.createIdentifier(name);
        switch (input.type) {
            case "string": {
                node.type = ts.createTypeReferenceNode("string", undefined);
                return node;
            }
            case "integer":
            case "number": {
                node.type = ts.createTypeReferenceNode("number", undefined);
                return node;
            }
            case "boolean": {
                node.type = ts.createTypeReferenceNode("boolean", undefined);
                return node;
            }
            case "array": {
                const items = (input as any).items;
                if (items.$ref) {
                    const arrayRef = items.$ref;
                    const refName = interfaceNameFromRef(arrayRef);
                    const arrayType = ts.createTypeReferenceNode(refName, undefined);
                    if (!isLocal) {
                        const leftName = ts.createIdentifier(options.defName);
                        arrayType.typeName = ts.createQualifiedName(leftName, refName);
                    }
                    node.type = ts.createArrayTypeNode(arrayType);
                }
                return node;
            }
        }
    }

    function getParamsFromObject(schemas: ISchemaObject[], isLocal = false) {
        return schemas.reduce((acc, schema) => {
            const {required, properties, type} = schema;
            const members = Object.keys((properties || {})).map((propertyName: string) => {
                const current: IDefinitionsItemProperties = properties[propertyName];
                return resolveItem(propertyName, current, required, isLocal);
            });
            return acc.concat(members);
        }, []).filter(Boolean);
    }

    function resolveItem(propertyName, current, required = [], isLocal = false) {
        if ((current as any).$ref) {
            const value = current.$ref;
            const refItem = namedProp(propertyName, required.indexOf(propertyName) === -1);
            const refName = interfaceNameFromRef(value);
            return getDefinitionReference(refItem, propertyName, refName, isLocal);
        }
        const item = namedProp(propertyName, required.indexOf(propertyName) === -1);
        if (current.type) {
            switch (current.type) {
                case "string": {
                    item.type = ts.createNode(ts.SyntaxKind.StringKeyword);
                    return item;
                }
                case "number":
                case "integer": {
                    item.type = ts.createNode(ts.SyntaxKind.NumberKeyword);
                    return item;
                }
                case "boolean": {
                    item.type = ts.createNode(ts.SyntaxKind.BooleanKeyword);
                    return item;
                }
                case "array": {
                    if (current.items.$ref) {
                        const arrayRef = current.items.$ref;
                        const refName = interfaceNameFromRef(arrayRef);
                        const arrayType = ts.createTypeReferenceNode(refName, undefined);
                        if (!isLocal) {
                            const leftName = ts.createIdentifier(options.defName);
                            arrayType.typeName = ts.createQualifiedName(leftName, refName);
                        }
                        item.type = ts.createArrayTypeNode(arrayType);
                    } else {
                        const arrayType: any = getLiteralType(current.items.type);
                        item.type = ts.createArrayTypeNode(arrayType);
                    }
                    return item;
                }
            }
        }
    }

    function getLiteralType(type: TypeKey) {
        switch (type) {
            case "string": {
                return ts.createNode(ts.SyntaxKind.StringKeyword);
            }
            case "boolean": {
                return ts.createNode(ts.SyntaxKind.BooleanKeyword);
            }
            case "integer":
            case "number": {
                return ts.createNode(ts.SyntaxKind.NumberKeyword);
            }
        }
    }

    function interfaceNameFromRef(ref: string): string {
        const [refName] = ref.split("/").slice(-1);
        return NonWordToCamelCase(refName);
    }

    function namedProp(name: string, optional = false) {

        const prop: any = ts.createNode(ts.SyntaxKind.PropertySignature);
        prop.name = ts.createIdentifier(name);

        if (optional) {
            prop.questionToken = ts.createNode(ts.SyntaxKind.QuestionToken);
        }

        return prop;
    }

    function moveDefaultToLast([key, value]: [string, any]) {
        return key === "default" ? 1 : 0;
    }

    function formatPathMethodName(refName: string): string {
        return NonWordToCamelCase(refName)
            .replace("#", "")
            .replace(/\//gi, "");
    }

    function generatePathParametersName(item: PathItemParam): string {
        return `${NonWordToCamelCase(item[0].in)}${upper(NonWordToCamelCase(item[0].name))}`;
    }

    function generatePathMethodName(item: MethodItem, methodType: MethodKeys): string {
        const sortedResponses = Object.entries(item.responses)
            .sort(moveDefaultToLast);

        // Find out if any parents have the ref as a key
        const refParent = sortedResponses.find(([name, responseObj]: [string, IResponsesItem]) => {
            return findKeyPresence(responseObj, ["$ref"]) !== false;
        })[1];

        if (refParent) {
            const ref = findKeyString(refParent, ["$ref"]);
            return `${methodType}${upper(formatPathMethodName(ref))}`;
        }

        // Find out if any parents have the ref as a key
        const descParent = sortedResponses.find(([name, responseObj]: [string, IResponsesItem]) => {
            return findKeyPresence(responseObj, ["description"]) !== false;
        })[1];

        const desc = findKeyString(descParent, ["description"]);
        return `${methodType}${upper(formatPathMethodName(desc))}`;
    }

    function findKey(object: any, keys: string[]): any {
        for (const property in object) {
            // Bypass default/inherited properties
            if (!object.hasOwnProperty(property)) {
                continue;
            }

            // Get recursing if there are depths to go.
            if (typeof object[property] === "object") {
                return findKey(object[property], keys);
            }

            // If the property is one that we're looking for, return the value
            if (keys.find((key) => key === property)) {
                return object[property];
            }
        }
        return false;
    }

    function findKeyPresence(object: any, keys: string[]): boolean {
        return findKey(object, keys) !== false;
    }

    function findKeyString(object: any, keys: string[]): string {
        return findKey(object, keys) + "";
    }
}

export interface SwaggerInput {
    paths: { [urlPath: string]: PathsItem };
    definitions: { [name: string]: DefinitionsItem };
}

export type MethodKeys = "put" | "post" | "get" | "delete";
export type ResponseCode = "200" | "401" | "default";

export interface PathsItem extends PathsMethodItem, PathsParam {}

export type PathsMethodItem = {
    [K in MethodKeys]: MethodItem
};

export interface PathsParam {
    parameters: PathItemParam[];
}

export interface PathItemParam {
    name: string;
    in: string;
    description?: string;
    required?: boolean;
}

export interface MethodItem {
    tags: string[];
    description: string;
    operationId?: string;
    produces?: string[];
    parameters: IParametersItem[];
    responses: { [K in ResponseCode]: IResponsesItem};
}

export interface SchemaParam {
    name: string;
    "in": "body";
    schema: ISchemaObject;

}

export interface PathParam {
    name: string;
    "in": "path";
    type: TypeKey;
    required: boolean;
    description?: string;
}

export type IParametersItem = SchemaParam | PathParam;

export interface ISchemaObject {
    required: string[];
    properties: IProperties;
    description?: string;
    type: "object";
}

export interface IProperties {
    [propertyName: string]: IDefinitionsItemProperties;
}

export type IResponsesSchema = {
    $ref: string
    type?: TypeKey,
} | IDefinitionsItemProperties;

export interface IResponsesItem {
    description: string;
    schema: IResponsesSchema;
}

export interface PropDefs {
    [index: string]: IDefinitionsItemProperties;
}

export interface DefinitionsItem {
    type: "object";
    properties?: PropDefs;
    required?: string[];
}

export type TypeKey = "string" | "object" | "boolean" | "number" | "integer" | "array";

export type IDefinitionsItemProperties = {
    type: "object";
    description?: string;
    properties?: PropDefs;
} | {
    type: "boolean";
    description?: string;
} | {
    type: "string";
    description?: string;
} | {
    type: "integer";
    description?: string;
} | {
    type: "number";
    description?: string;
} | {
    type: "array"
    description?: string;
    items: IDefinitionsItemProperties | IResponsesSchema
};
