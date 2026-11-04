const ts = require('typescript');
const writeMethods = new Set(['create','createMany','createManyAndReturn','upsert']);
const relations = new Set(['contents','variantA','variantB','content']);
function property(node) {
  return ts.isPropertyAccessExpression(node) ? node.name.text :
    ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
}
function violations(source, delegate = () => false) {
  const found = [];
  const isContent = node => node && (delegate(node) || property(node) === 'content');
  function visit(node) {
    if ((ts.isVariableDeclaration(node) || ts.isBindingElement(node)) && delegate(node.name)) found.push('delegate_alias');
    if (ts.isVariableDeclaration(node) && node.initializer && (delegate(node.initializer) || property(node.initializer) === 'content' && /^(?:prisma|db|tx|\(prisma\s+as\s+any\))$/.test(node.initializer.expression?.getText(source) ?? ''))) found.push('delegate_alias');
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && isContent(node.expression) && writeMethods.has(property(node))) found.push('content_write');
    if (ts.isBindingElement(node)) {
      const declaration = node.parent.parent;
      if (ts.isVariableDeclaration(declaration) && declaration.initializer && isContent(declaration.initializer)) found.push('method_alias');
    }
    if (ts.isPropertyAssignment(node) && relations.has(node.name.getText(source).replace(/['"]/g,''))) {
      function nested(child) {
        if (ts.isPropertyAssignment(child) && writeMethods.has(child.name.getText(source).replace(/['"]/g,''))) found.push('nested_content_write');
        ts.forEachChild(child,nested);
      }
      nested(node.initializer);
    }
    if (ts.isStringLiteralLike(node) && /(?:INSERT\s+INTO|MERGE\s+INTO)\s+(?:"?\w+"?\.)?["`]?contents\b/i.test(node.text)) found.push('raw_content_write');
    if (ts.isTaggedTemplateExpression(node) && /(?:INSERT\s+INTO|MERGE\s+INTO)\s+(?:"?\w+"?\.)?["`]?contents\b/i.test(node.template.getText(source))) found.push('raw_content_write');
    if (ts.isStringLiteralLike(node) && /(?:^|\/)publish\/(facebook|instagram|naver-cafe)(?:\.[cm]?[jt]sx?)?$|^\.\/(facebook|instagram|naver-cafe)(?:\.[cm]?[jt]sx?)?$/.test(node.text)) {
      const parent=node.parent;
      if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isCallExpression(parent)) found.push('adapter_import');
    }
    ts.forEachChild(node,visit);
  }
  visit(source); return found;
}
module.exports={violations};
