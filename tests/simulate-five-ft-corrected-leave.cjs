// Current corrected human-leave simulation; see tests/README.md.
const {execFileSync}=require('node:child_process');
execFileSync(process.execPath,[require('node:path').join(__dirname,'analyze-fairness.cjs')],{stdio:'inherit'});
