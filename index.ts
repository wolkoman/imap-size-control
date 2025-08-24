import * as imaps from "imap-simple";
import { ImapSimple } from "imap-simple";
import PostalMime, { Email } from "postal-mime";
import { config } from "./config.js";
import * as Imap from "imap";
import * as fs from "fs";

imaps.connect(config).then(async (connection) => {
  try {
    const mailboxes = listBoxes(await connection.getBoxes());
    await mailboxes.reduce<Promise<void>>(async (promise, box) => {
      await promise;
      await handleMailbox(connection, box);
    }, Promise.resolve());

    console.log("All mailboxes processed. Closing main connection...");
    await connection.end();
    console.log("Process completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error during processing:", error);
    await connection.end();
    process.exit(1);
  }
});

function listBoxes(boxes: Imap.MailBoxes, prepend = ""): string[] {
  if (boxes === null) return [];
  return Object.entries(boxes)
    .flatMap(([name, { delimiter, children }]) => [
      name,
      ...listBoxes(children, name + delimiter),
    ])
    .map((name) => prepend + name);
}

async function handleMailbox(connection: ImapSimple, mailbox: string) {
  await connection.openBox(mailbox);
  const searchCriteria = [
    ["LARGER", 10_000_000],
    ["BEFORE", new Date(2023, 1, 1)],
  ];
  const fetchOptions = { bodies: [""], markSeen: false };
  const results = await connection.search(searchCriteria, fetchOptions);
  console.log(`${mailbox}: Found ${results.length} results!`);

  // parse mails
  const mails = await results.reduce(
    async (promise, item) =>
      promise.then(async (mails) => {
        const all = item.parts.find((item) => item.which === "")!;
        const uid = item.attributes.uid;
        const idHeader = "Imap-Id: " + uid + "\r\n";

        try {
          const emailContent = String(idHeader + all.body);
          const mail = await PostalMime.parse(emailContent);
          return [...mails, { mail, uid }];
        } catch (error) {
          console.error(`[ERROR] Failed to parse mail ${uid}:`, error);
          throw error;
        }
      }),
    Promise.resolve([] as { mail: Email; uid: number }[])
  );
  console.log(
    mails.map(({ mail }) => `${mail.date} ${mail.subject}`).join("\n")
  );

  // save files and install replacement
  if (results.length !== 0) console.log("Restoring and saving");
  await mails.reduce<Promise<void>>(async (promise, { mail, uid }) => {
    await promise;
    const files = await saveFilesInMail(mail, mailbox, uid);
    await connection.append(generateReplacementMail(mail, files, uid), {
      mailbox,
      date: mail.date ? new Date(mail.date) : new Date("2020-01-01"),
      flags: ["\\Seen"],
    });
  }, Promise.resolve());

  // delete originals mails
  if (results.length !== 0) console.log("Deleting");
  await deleteMails(
    mails.map((mail) => mail.uid),
    connection
  );

  return connection.closeBox(true);
}

function generateReplacementMail(
  mail: Email,
  files: string[],
  uid: number
): any {
  const to = (Array.isArray(mail.to) ? mail.to : [mail.to])
    .flatMap((to) => to?.address || to)
    .filter((to) => !!to);
  const content = mail.html ? mail.html : mail.text;
  const c =
    (content?.length ?? 0) > 1_000_000
      ? `Der Inhalt ist zu groß (UID ${uid}, date ${mail.date}, messageid ${mail.messageId}).`
      : content;
  return `Content-Type: text/html
To:${to.join(";")}
Subject: ${mail.subject}

${c}\n<br/>Folgende Dateien im Anhang wurden ausgelagert: ${files.join(
    ",\n<br/>"
  )}
`;
}

function deleteMails(mails: number[], connection: imaps.ImapSimple) {
  return Promise.all(
    mails.map((id) => {
      console.log(`[INFO] Deleting mail ${id}`);
      return connection.deleteMessage([id]);
    })
  );
}

function saveFilesInMail(mail: Email, mailbox: string, uid: number) {
  const path = `${config.imap.user}/${mailbox}`;
  fs.mkdirSync(path, { recursive: true });
  fs.writeFileSync(`${path}/${uid}.txt`, mail.text || "");
  return Promise.all(
    mail.attachments.map(async (attachment, index) => {
      console.log(`Save ${mail.date} ${mail.subject} ${attachment.filename}`);
      const newFileName = `${new Date(mail.date ?? "")
        .toISOString()
        .substring(0, 10)}_${uid}_${index}_${attachment.filename}`;
      if (typeof attachment.content === "string") {
        fs.writeFileSync(`${path}/${newFileName}`, attachment.content, "utf8");
      } else {
        fs.writeFileSync(
          `${path}/${newFileName}`,
          new Uint8Array(attachment.content)
        );
      }
      return newFileName;
    })
  );
}
