#!/usr/bin/env node

const Conf = require("conf");
const process = require("process");
const program = require("commander");
const inquirer = require("inquirer");
const ora = require("ora");
const _ = require("lodash");
const metascraper = require("metascraper")([require("metascraper-title")()]);
const got = require("got");
const validUrl = require("valid-url");
const crypto = require("crypto");
const normalizeUrl = require("normalize-url");
const fuzzy = require("fuzzy");
const opn = require("opn");
const treeify = require("treeify");
const terminalLink = require("terminal-link");
require("colors");

const { stdin, stdout } = process;

const output = {
  info: text => console.info(">".green, text.bold),
  err: text => console.error("x".red, text.bold),
  spinner: text => ora({ text, stream: stdout }).start(),
  prompt: inquirer.createPromptModule({ output: stdout, input: stdin })
};

output.prompt.registerPrompt(
  "autocomplete",
  require("inquirer-autocomplete-prompt")
);

const hashUrl = url =>
  crypto
    .createHash("md5")
    .update(normalizeUrl(url))
    .digest("hex");

const config = new Conf();
const store = {
  getItem(url) {
    const hash = hashUrl(url);
    return this.getItems().find(x => x.hash === hash);
  },
  addItem(item) {
    const items = this.getItems();
    items.push(item);
    this.saveItems(items);
  },
  removeItem(item) {
    const items = this.getItems().filter(x => x.url === item.url);
    this.saveItems(items);
  },
  getItems() {
    return config.get("items") || [];
  },
  saveItems(items) {
    config.set("items", items);
  },
  getCollections() {
    return _.chain(this.getItems())
      .map(x => x.collection)
      .uniq()
      .value();
  },
  getCollectionItems(collection) {
    return this.getItems().filter(x => x.collection === collection);
  },
  fuzzySearchCollections(input) {
    if (!input) {
      return this.getCollections();
    }
    return fuzzy.filter(input, this.getCollections()).map(x => x.string);
  }
};

async function createItem(url, collection) {
  const { body: html } = await got(url, { throwHttpErrors: false });
  const meta = await metascraper({ html, url });
  const hash = hashUrl(url);
  return { hash, url, collection, ...meta };
}

async function addCommand(url) {
  if (!validUrl.isUri(url)) {
    return output.err("The provided url is not valid");
  }
  const existingItem = store.getItem(url);
  if (existingItem) {
    return output.err(
      `The provided url has already been added to ${existingItem.collection}`
    );
  }
  const collection = await selectCollection(true);

  const spnr = output.spinner("Fetching metadata");
  const item = await createItem(url, collection);
  spnr.stop();

  item.title = await inputTitle(item.title);

  store.addItem(item);

  output.info("Following item has been added!");
}

async function selectCollection() {
  let currentInput = "";
  const createCollectionStr = "create collection: ";
  const answers = await output.prompt({
    type: "autocomplete",
    name: "collection",
    message: "Choose a new/existing collection",
    suggestOnly: true,
    validate: val => val.length > 0,
    source: (answers, input) => {
      currentInput = input || "";
      const choices = store.fuzzySearchCollections(input);
      if (currentInput.length) {
        choices.push(createCollectionStr + currentInput);
      }
      return Promise.resolve(choices);
    }
  });

  return answers.collection.replace(createCollectionStr, "");
}

async function selectItem(collection) {
  const items = await store.getCollectionItems(collection);
  const choices = items.map(x => x.title);
  const answers = await output.prompt({
    type: "list",
    name: "item",
    message: "Open an item",
    choices
  });
  const i = choices.indexOf(answers.item);
  return items[i];
}

async function inputTitle(suggestedTitle) {
  const answers = await output.prompt({
    type: "input",
    name: "title",
    message: "What should the title be?",
    default: suggestedTitle,
    validate: input => input.length > 0
  });
  return answers.title;
}

async function removeCommand() {
  const collection = await selectCollection();
  const item = await selectItem(collection);
  store.removeItem(item);
  output.info("Bookmark removed!");
}

async function openCommand() {
  const collection = await selectCollection();
  const item = await selectItem(collection);
  await opn(item.url);
}

async function listCommand() {
  const collections = {};
  for (const item of store.getItems()) {
    const title = _.truncate(item.title, {length: 40}).green;
    const url = (new URL(item.url).hostname + "/…").blue;

    collections[item.collection] = Object.assign(
      { [title]: terminalLink(url, item.url) },
      collections[item.collection]
    );
  }
  const tree = treeify.asTree(collections, true);
  console.log("collections".bold);
  console.log(tree);
}

program.description("CLI bookmark organizer");

program
  .command("add <url>")
  .description("Add a new bookmark")
  .action(addCommand);

program
  .command("remove")
  .description("Remove a bookmark")
  .action(removeCommand);

program
  .command("open")
  .description("Open a bookmark")
  .action(openCommand);

program
  .command("list")
  .description("List all bookmarks")
  .action(listCommand);

program.parse(process.argv);

if (!process.argv.slice(2).length) {
  program.outputHelp();
}