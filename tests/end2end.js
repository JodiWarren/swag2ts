const {createSplitDefs} = require("../dist/swagger");

const {readFileSync, readdirSync} = require('fs');
const assert = require('assert');

const hasJsonExtension = filename => filename.substr(-5) === '.json';

const stubs = readdirSync('./fixtures').filter(hasJsonExtension);

describe("Swag2TS compiles without crash when reading", function() {
    stubs.forEach(stub => {
        it(stub, function() {
            const swaggerJson = JSON.parse(readFileSync(`./fixtures/${stub}`, 'utf8'));
            createSplitDefs(swaggerJson)
        });
    });
});
