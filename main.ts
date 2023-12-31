import * as si from "npm:systeminformation";

type SysInfo = {
  os: {
    platform: string,
    distro: string,
    release: string,
    codename: string,
  },
  cpu: {
    manufacturer: string,
    brand: string,
    cores: number
  },
  mem: {
    totalgb: number,
  },
  gpu:
  {
    gpu: string,
    vram: number,
    cores: number
  }[]

}

type GenerateOutput = {
  model: string,
  created_at: string,
  message: {
    role: string,
    content: string
  },
  done: boolean,
  total_duration: number,
  load_duration: number,
  prompt_eval_count: number,
  prompt_eval_duration: number,
  eval_count: number,
  eval_duration: number
}

type TestRunOutput = {
  model: string,
  firstgen: GenerateOutput,
  secondgen: GenerateOutput,
  thirdgen: GenerateOutput,
  fourthgen: GenerateOutput,
  averagetps: number
}

type OBMOutput = {
  testdate: string,
  ollamaversion: string,
  sysinfo: SysInfo,
  performance: TestRunOutput[],
  OBMVersion: string,
  OBMScore: string
}

const obmversion = "0.0.1";
async function ollamaversion() {
  const cmd = new Deno.Command("ollama", {
    args: ["--version"],
  })
  const output = await cmd.output();
  const regex = /\d+\.\d+\.\d+/;
  let versionNumber = "unknown";

  const match = new TextDecoder().decode(output.stdout).match(regex);


  if (match) {
    versionNumber = match[0]; // Extract the matched version number
  }
  return versionNumber;
}

async function prepModel(model: string, host: string) {
  const body = {
    "name": model,
    "stream": false
  };
  const localmodels = await fetch(`${host}/api/tags`, {
    method: "get"
  });
  const jsonlocalmodels: { models: { name: string }[] } = await localmodels.json()
  const modellist = jsonlocalmodels.models.map(m => {
    return m.name;
  });
  if (!modellist.includes(model)) {
    console.log(`${model} is not on this system. Downloading first.`)

    const response = await fetch(`${host}/api/pull`, {
      method: "post",
      body: JSON.stringify(body)
    })
    const jsonresponse = await response.json();
    if (jsonresponse.status === "success") {
      console.log(`Pulled ${model}`);
    } else {
      throw new Error("Error pulling model");
    }
  }
}

export async function generate(prompt: string, model: string, host: string): Promise<GenerateOutput> {
  const body = {
    "model": model,
    "messages": [
      {
        "role": "user",
        "content": prompt
      }
    ],
    "stream": false
  }
  const response = await fetch(`${host}/api/chat`, {
    method: "post",
    body: JSON.stringify(body)
  });
  const jsonResponse = await response.json();
  jsonResponse.eval_duration = jsonResponse.eval_duration / 1e9;
  jsonResponse.total_duration = jsonResponse.total_duration / 1e9;
  jsonResponse.load_duration = jsonResponse.load_duration / 1e9;
  jsonResponse.prompt_eval_duration = jsonResponse.prompt_eval_duration / 1e9;
  return jsonResponse;
}
function memMultiplier(type: "ram" | "vram", platform: string): number {
  const mults = [
    {
      platform: "linux",
      ram: 1000 * 1024 * 1024,
      vram: 1024
    }, {
      platform: "windows",
      ram: 1000 * 1024 * 1024,
      vram: 1024
    }, {
      platform: "darwin",
      ram: 1024 * 1024,
      vram: 1
    },
  ]

  const mult = mults.filter(m => m.platform === platform).map(m => m[type])[0];

  return mult;
}

export async function sysinfo(): Promise<SysInfo> {
  const cpu = await si.cpu();
  const mem = await si.mem();
  // console.log(mem);
  const gpu = await si.graphics();
  // console.log(gpu);
  const os = await si.osInfo();

  const cpuinfo = { manufacturer: cpu.manufacturer, brand: cpu.brand, cores: cpu.cores };
  const meminfo = { totalgb: parseInt((mem.total / memMultiplier("ram", os.platform)).toFixed(0)) }
  const gpustats = gpu.controllers.map(g => {
    let gpuvendor = `${g.vendor} ${g.model}`;
    if (gpuvendor === "NVIDIA Corporation Device 20b0") {
      gpuvendor = "NVIDIA Corporation Device A100"
    }
    return { gpu: gpuvendor, vram: (g.vram as number / memMultiplier("vram", os.platform)) || (meminfo.totalgb), cores: (g.cores) || 0 }
  })
  const osinfo = { platform: os.platform, distro: os.distro, release: os.release, codename: os.codename }
  const sysinfo = {
    os: osinfo,
    cpu: cpuinfo,
    mem: meminfo,
    gpu: gpustats,
  }

  // console.log(sysinfo);
  return sysinfo;
}

function averageTokensPerSecond(first: GenerateOutput, second: GenerateOutput, third: GenerateOutput, fourth: GenerateOutput): number {
  const firsttps = first.eval_count / first.eval_duration;
  const secondtps = second.eval_count / second.eval_duration;
  const thirdtps = third.eval_count / third.eval_duration;
  const fourthtps = fourth.eval_count / fourth.eval_duration;

  const average = (firsttps + secondtps + thirdtps + fourthtps) / 4;

  return average;
}



async function testrun(prompt: string, hostString: string, model: string): Promise<TestRunOutput> {
  const firstgen = await generate(prompt, model, hostString);
  console.log(`First run of ${model} took ${firstgen.load_duration.toFixed(2)} seconds to load then ${firstgen.eval_duration.toFixed(2)} seconds to evaluate with ${(firstgen.eval_count / firstgen.eval_duration).toFixed(2)} tokens per second`)
  const secondgen = await generate(prompt, model, hostString);
  console.log(`Second run of ${model} took ${secondgen.load_duration.toFixed(2)} seconds to load then ${secondgen.eval_duration.toFixed(2)} seconds to evaluate with ${(secondgen.eval_count / secondgen.eval_duration).toFixed(2)} tokens per second`)
  const thirdgen = await generate(prompt, model, hostString);
  console.log(`Third run of ${model} took ${thirdgen.load_duration.toFixed(2)} seconds to load then ${thirdgen.eval_duration.toFixed(2)} seconds to evaluate with ${(thirdgen.eval_count / thirdgen.eval_duration).toFixed(2)} tokens per second`)
  const fourthgen = await generate(prompt, model, hostString);
  console.log(`Fourth run of ${model} took ${fourthgen.load_duration.toFixed(2)} seconds to load then ${fourthgen.eval_duration.toFixed(2)} seconds to evaluate with ${(fourthgen.eval_count / fourthgen.eval_duration).toFixed(2)} tokens per second`)
  const averagetps = averageTokensPerSecond(firstgen, secondgen, thirdgen, fourthgen)
  console.log(`Average Tokens per Second for ${model} is ${averagetps.toFixed(2)}\n`)
  return { model, firstgen, secondgen, thirdgen, fourthgen, averagetps }
}

if (import.meta.main) {
  const ollamaVersion = await ollamaversion();
  const standardPrompt = "Why is the sky blue?";
  const hostString = "http://127.0.0.1:11434";
  const sysInfo: SysInfo = await sysinfo();

  console.log(`${sysInfo.os.distro} ${sysInfo.os.release} with ${sysInfo.mem.totalgb}GB and ${sysInfo.cpu.manufacturer} ${sysInfo.cpu.brand} with ${sysInfo.cpu.cores} cores`)
  if (sysInfo.gpu.length > 0) {
    console.log("GPU Info:");
    sysInfo.gpu.forEach(g => {
      const corestring = g.cores > 0 ? ` and ${g.cores} cores` : "";
      console.log(`${g.gpu} with ${g.vram}GB vram${corestring}`)
    })
    console.log("");
  }
  console.log(`Using Ollama version: ${ollamaVersion}`)
  const mem = sysInfo.mem.totalgb;
  console.log("Ensuring models are loaded")
  await prepModel("orca-mini:latest", hostString);
  await prepModel("llama2:7b", hostString);
  console.log("Loading orca-mini to reset")
  await generate("", "orca-mini", hostString);

  const fullInfo: OBMOutput = {
    "testdate": new Date().toISOString(),
    "ollamaversion": ollamaVersion,
    "sysinfo": sysInfo,
    "performance": [],
    "OBMVersion": obmversion,
    "OBMScore": "0"
  }

  console.log("Loading llama2:7b");
  fullInfo.performance.push(await testrun(standardPrompt, hostString, "llama2:7b"))
  if (mem > 13) {
    await prepModel("llama2:13b", hostString);
    console.log(`Loading llama2:13b`);
    fullInfo.performance.push(await testrun(standardPrompt, hostString, "llama2:13b"));
  };
  if (mem > 63) {
    await prepModel("llama2:70b", hostString);
    console.log(`Loading llama2:70b`);
    fullInfo.performance.push(await testrun(standardPrompt, hostString, "llama2:70b"));
  }

  const proceed = confirm("Do you approve to send the output from this command to obm.tvl.st to share with everyone? No personal info is included");
  if (proceed) {
    const submitresponse = await fetch("https://obm.tvl.st/api/postbm", {
      "method": "post",
      "body": JSON.stringify(fullInfo)
    });

    const json = await submitresponse.json()
    console.log(`Your OBMScore is ${json.OBMScore.obmscore} and is made of 3 components: \nllama2:7b OBMScore: ${json.OBMScore.obm7}\nllama2:13b OBMScore: ${json.OBMScore.obm13}\nllama2:70b OBMScore: ${json.OBMScore.obm70}`);
  }

}
