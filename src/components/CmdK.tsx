import React from "react";
import Icon from "./Icon";
import { Dialog, DialogTrigger, DialogContent } from "./ui/dialog";

export const CmdK = () => {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="ml-auto hover:text-baby-blue-eyes">
          <Icon id="search" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <input
          type="text"
          placeholder="Search..."
          className="focus:none outline-0 focus:outline-0"
        />
      </DialogContent>
    </Dialog>
  );
};
