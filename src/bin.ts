#!/usr/bin/env node
import {existsSync, readFileSync} from "fs";
import {outputFileSync} from "fs-extra";
import stdin = require("get-stdin");
import {OrderedSet} from "immutable";
import minimist = require("minimist");
import {join, parse, ParsedPath} from "path";
import {SwaggerInput} from "./parser";
import {createDefs, createSplitDefs, getOptions, OutputTypes} from "./swagger";

const argv = minimist(process.argv.slice(2));

// unique input
const inputs = OrderedSet<string>(argv._);

const options = getOptions(argv);

// merged options with defaults

function createOutput(json: SwaggerInput) {

    switch (options.outputType) {
        case OutputTypes.Single: {
            // tslint:disable-next-line
            return console.log(createDefs(json, options));
        }
        case OutputTypes.Multi: {
            const res = createSplitDefs(json, options);
            const defOutput = join(options.outDir, res.definitions[0].displayName);

            res.modules.concat(res.definitions).forEach((item) => {
                outputFileSync(join(options.outDir, item.displayName), item.content);
            });
            // tslint:disable-next-line
            console.log(`${res.modules.length} module(s) written to '${options.outDir}'`);
            // tslint:disable-next-line
            console.log(`1 definition file written to '${defOutput}'`);

            break;
        }
        default: {
            // tslint:disable-next-line
            return console.error("Output type not supported");
        }
    }
}

if (options.stdin) {
    stdin().then((str: string) => {
        if (str === "") {
            // tslint:disable-next-line
            console.error("no input provided");
        } else {
            try {
                // tslint:disable-next-line
                const json = JSON.parse(str);
                createOutput(json);
            } catch (e) {
                // tslint:disable-next-line
                console.error("Invalid JSON");
                // tslint:disable-next-line
                console.error(e.message);
            }
        }
    })
        .catch((err) => {
            // tslint:disable-next-line
            console.error(err);
        });
} else {
    if (inputs.size === 0) {
        // tslint:disable-next-line
        console.error("Oops! You provided no inputs");
        // tslint:disable-next-line
        console.log(`
You can pipe JSON to this program with the --stdin flag:

    curl http://example.com/some-json | swag2ts --stdin

Or, provide path names:

    swag2ts path/to/my-file.json
        `);
    } else {
        const queue = inputs
            .map((input) => {
                return {
                    input,
                    parsed: parse(input),
                };
            })
            .map((incoming) => {
                return {
                    incoming,
                    resolved: resolveInput(incoming, process.cwd()),
                };
            });

        const withErrors = queue.filter((x) => x.resolved.errors.length > 0);
        const withoutErrors = queue.filter((x) => x.resolved.errors.length === 0);
        if (withErrors.size) {
            // tslint:disable-next-line
            console.log("Sorry, there were errors with your input.");
            withErrors.forEach(function(item) {
                // tslint:disable-next-line
                console.log("");
                // tslint:disable-next-line
                console.log(`  ${item.incoming.input}:`);
                // tslint:disable-next-line
                console.log("    ", item.resolved.errors[0].error.message);
            });
        } else {
            withoutErrors.map((item) => {
                return item.resolved.content;
            })
                .forEach((json: any) => {
                    // tslint:disable-next-line
                    createOutput(json);
                });
        }
    }
}

interface IIncomingInput {
    input: string;
    parsed: ParsedPath;
}

interface InputError {
    kind: string;
    error: Error;
}

interface IResolvedInput {
    errors: InputError[];
    content?: string;
}

function resolveInput(incoming: IIncomingInput, cwd): IResolvedInput {
    const absolute = join(cwd, incoming.parsed.dir, incoming.parsed.base);
    if (!existsSync(absolute)) {
        return {
            errors: [{
                error: new Error(`File not found`),
                kind: "FileNotFound",
            }],
        };
    }
    const data = readFileSync(absolute, "utf8");
    try {
        return {
            content: JSON.parse(data),
            errors: [],
        };
    } catch (e) {
        return {
            errors: [{
                error: e,
                kind: "InvalidJson",
            }],
        };
    }
}
