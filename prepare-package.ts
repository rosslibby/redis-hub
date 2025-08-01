import fs from 'fs';
import path from 'path';
const devPkg = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
);
const readme = fs.readFileSync(path.join(process.cwd(), 'README.md'), 'utf-8');

(function prepare() {
  const distPkg = cleanPkg(devPkg);
  const { name, version } = distPkg;

  console.log(`🎬 Preparing ${name} for publish to NPM`);
  console.log(`⚡️ Upgraded to version ${version}`);

  const distPkgPath = path.join(process.cwd(), 'dist', 'package.json');
  fs.writeFileSync(
    distPkgPath,
    Buffer.from(JSON.stringify(distPkg, null, 2)),
    'utf-8',
  );
  console.log(`✅ Finished preparing ${name}`);
  console.log(`📋 Copying README`);

  const distReadmePath = path.join(process.cwd(), 'dist', 'README.md');
  fs.writeFileSync(
    distReadmePath,
    Buffer.from(readme),
    'utf-8',
  );
  console.log(`✅ Finished copying README`);
})();

function cleanPkg(config: any): any {
  const { name, version, main, module, types, exports, scripts, devDependencies, ...rest } = config;

  return {
    name,
    version,
    main: main.replace(/dist\//, ''),
    module: module.replace(/dist\//, ''),
    types: types.replace(/dist\//, ''),
    ...rest,
    exports: {
      ...exports,
      '.': {
        ...exports['.'],
        import: exports['.'].import.replace(/dist\//, ''),
        require: exports['.'].require.replace(/dist\//, ''),
      },
    },
  };
}
