import * as ts from 'typescript';
import {createConst, createInterface, createModule, createStatement} from "./swagger";
import {Statement} from "typescript";

export const kindMap = {
    [ts.SyntaxKind.NullKeyword]: ts.SyntaxKind.NullKeyword,
    [ts.SyntaxKind.StringLiteral]: ts.SyntaxKind.StringKeyword,
    [ts.SyntaxKind.FirstLiteralToken]: ts.SyntaxKind.NumberKeyword,
    [ts.SyntaxKind.TrueKeyword]: ts.SyntaxKind.BooleanKeyword,
    [ts.SyntaxKind.FalseKeyword]: ts.SyntaxKind.BooleanKeyword,
    [ts.SyntaxKind.NumericLiteral]: ts.SyntaxKind.NumberKeyword,
};

export function parse(json: SwaggerInput): Array<[string, Statement[]]> {
    const parsed = Object
        .keys(json.paths)
        .map(key => ({key, current: json.paths[key]}))
        .reduce((acc, {key, current}) => {
            return acc.concat(Object
                .keys(current)
                .map((methodType: MethodKeys) => {
                    const item: MethodItem = current[methodType];
                    const name = item.tags[0];
                    const bodyMembers = getParamsFromObject(item.parameters.filter(x => x.in === 'body').map(x => x.schema));
                    const responses = item.responses;
                    return {
                        displayName: upper(name) + upper(methodType),
                        method: methodType,
                        body: createInterface('Body', bodyMembers),
                        responses: getResponses(item.responses),
                        variables: {
                            path: key,
                            description: item.description,
                            operationId: item.operationId,
                        }
                    }
                }));
        }, []);


    const modules = parsed.map((item): [string, Statement[]] => {
        const vars = Object
            .keys(item.variables)
            .map(key => [key, item.variables[key]])
            .map(([name, value]) => {
                return createStatement(createConst(name, value));
            });

        const responses = item.responses;

        const statements = [...vars, item.body, ...responses];

        return [item.displayName, statements];
    });

    return modules;
}

export function dashToStartCase(string) {
    return string.split('-').map(x => upper(x)).join('')
}

export function upper(string) {
    return string[0].toUpperCase() + string.slice(1);
}

export function getResponses(responses: { [K in ResponseCode ]: IResponsesItem}) {
    return Object.keys(responses).map(code => {
        const current = responses[code];
        const schema: IDefinitionsItemProperties = current.schema;
        const typeName = `Response${code === 'default' ? 'Default' : code}`;
        if (schema['$ref']) {
            const dashRefName = interfaceNameFromRef(schema['$ref']);
            const node : any = ts.createNode(ts.SyntaxKind.TypeAliasDeclaration);
            node.modifiers = [ts.createToken(ts.SyntaxKind.ExportKeyword)];
            return getDefRef(node, typeName, dashRefName);
        } else {
            // const [refName] = schema['$ref'].split('/').slice(-1);
            // const dashRefName = dashToStartCase(refName);
            // const node : any = ts.createNode(ts.SyntaxKind.TypeAliasDeclaration);
            // node.modifiers = [ts.createToken(ts.SyntaxKind.ExportKeyword)];
            // return getDefRef(node, typeName, dashRefName);
            // console.log(resolveItem());
        }
    }).filter(Boolean);
}

function getDefRef(node, name, refName) {
    const leftName = ts.createIdentifier('Definitions');
    node.type = ts.createTypeReferenceNode(refName, undefined);
    node.type.typeName = ts.createQualifiedName(leftName, refName);
    node.name = ts.createIdentifier(name);
    return node;
}

export function getParamsFromObject(schemas: ISchema[]) {
    return schemas.reduce((acc, schema) => {
        const {required, properties, type} = schema;
        const members = Object.keys(properties).map((propertyName: string) => {
            const current: IDefinitionsItemProperties = properties[propertyName];
            return resolveItem(propertyName, current, required);
        });
        return acc.concat(members);
    }, []).filter(Boolean);
}

export function resolveItem(propertyName, current, required = []) {
    if ((current as any)['$ref']) {
        const value = current['$ref'];
        const item = namedProp(propertyName, required.indexOf(propertyName) === -1);
        const refName = interfaceNameFromRef(value);
        return getDefRef(item, propertyName, refName);
    }
    if (current.type) {
        switch(current.type) {
            case "string": {
                const item = namedProp(propertyName, required.indexOf(propertyName) === -1);
                item.type = ts.createNode(ts.SyntaxKind.StringKeyword);
                return item;
            }
            case "number":
            case "integer": {
                const item = namedProp(propertyName, required.indexOf(propertyName) === -1);
                item.type = ts.createNode(ts.SyntaxKind.NumberKeyword);
                return item;
            }
            case "boolean": {
                const item = namedProp(propertyName, required.indexOf(propertyName) === -1);
                item.type = ts.createNode(ts.SyntaxKind.BooleanKeyword);
                return item;
            }
            case "array": {
                const item = namedProp(propertyName, required.indexOf(propertyName) === -1);
                if (current.items['$ref']) {
                    const arrayRef = current.items['$ref'];
                    const refName = interfaceNameFromRef(arrayRef);
                    return getDefRef(item, propertyName, refName);
                }
                const arrayType: any = getLiteralType(current.items.type);
                item.type = ts.createArrayTypeNode(arrayType);
                return item;
            }
        }
    }
}

export function getLiteralType(type: TypeKey) {
    switch(type) {
        case "string": {
            return ts.createNode(ts.SyntaxKind.StringKeyword)
        }
        case "boolean": {
            return ts.createNode(ts.SyntaxKind.BooleanKeyword)
        }
        case "integer":
        case "number": {
            return ts.createNode(ts.SyntaxKind.NumberKeyword)
        }
    }
}

export function interfaceNameFromRef(ref: string): string {
    const [refName] = ref.split('/').slice(-1);
    return dashToStartCase(refName);
}

export function namedProp(name: string, optional = false) {

    const prop: any = ts.createNode(ts.SyntaxKind.PropertySignature);
    prop.name = ts.createIdentifier(name);

    if (optional) {
        prop.questionToken = ts.createNode(ts.SyntaxKind.QuestionToken);
    }

    return prop;
}


export interface SwaggerInput {
    paths: { [urlPath: string]: PathsItem }
    definitions: { [name: string]: DefinitionsItem }
}

export type MethodKeys = "put" | "post" | "get" | "delete";
export type ResponseCode = "200" | "401" | "default";
export type PathsItem = { [K in MethodKeys ]: MethodItem }

export interface MethodItem {
    tags: string[];
    description: string;
    operationId: string;
    parameters: IParametersItem[];
    responses: { [K in ResponseCode ]: IResponsesItem};
}

export interface IParametersItem {
    name: string;
    'in': string;
    schema: ISchema;
}

export interface ISchema {
    required: string[];
    properties: IProperties;
    type: "object";
}

export interface IProperties {
    [propertyName: string]: IDefinitionsItemProperties
}

export interface IResponsesSchema {
    $ref: string
}

export interface IResponsesItem {
    description: string;
    schema: IResponsesSchema;
}

export type PropDefs = { [index: string]: IDefinitionsItemProperties };

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
    items: IDefinitionsItemProperties
}
