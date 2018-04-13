const {createSplitDefs} = require("../dist/swagger");
const {readFileSync, readdirSync} = require('fs');

const hasJsonExtension = filename => filename.substr(-5) === '.json';

describe("Swag2TS compiles without crash when reading", function() {
    const stubs = readdirSync('./fixtures').filter(hasJsonExtension);

    stubs.forEach(stub => {
        it(stub, function() {
            const swaggerJson = JSON.parse(readFileSync(`./fixtures/${stub}`, 'utf8'));
            createSplitDefs(swaggerJson)
        });
    });
});
